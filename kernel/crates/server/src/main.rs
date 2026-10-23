//! Hosts kernel rooms over HTTP and pushes their steps to browsers over SSE.
//! Every request is made as an observer (`as`: `dm`, the default, or a seat's name) and everything
//! sent back is rendered for that observer, in their names. Step ids can be written `12` or `"#12"`.
//!
//!   GET  /api/rooms                              the rooms on offer, with their seats
//!   GET  /api/rooms/{id}?as                      the room as that observer sees it
//!   POST /api/rooms/{id}/commands                { as?, gist?, commands: [Command], dry_run? } → one step
//!   GET  /api/rooms/{id}/history?as&limit&branch the last steps, one line each (default 20, main)
//!   GET  /api/rooms/{id}/branches                branches and their heads (DM)
//!   POST /api/rooms/{id}/surgery                 { op: insert|remove|edit|keep_as_fiat, …, gist? } → a draft
//!                                                branch and a summary-first preview (DM)
//!   POST /api/rooms/{id}/branches/{name}/commit  make a draft the main branch (DM)
//!   POST /api/rooms/{id}/branches/{name}/discard throw a draft away (DM)
//!   POST /api/rooms/{id}/rewind                  { step } → move main's head back (DM)
//!   GET  /api/rooms/{id}/stream?as&since         SSE: missed steps since `since`, then live ones;
//!                                                `reset` when history changes; `notice` for a seat's messages
//!
//! The DM's inbox:
//!   POST /api/rooms/{id}/messages                { as: seat, text, at? } → acknowledged at once
//!   GET  /api/rooms/{id}/messages?as             a seat's own messages and replies (DM: all)
//!   GET  /api/rooms/{id}/wait?timeout            DM: blocks until messages arrive, then returns them
//!                                                as one batch with a context bundle
//!   POST /api/rooms/{id}/messages/{n}/reply      { text, done? } (DM)
//!   GET  /api/rooms/{id}/pending                 DM: how many messages are unseen and open
//!   GET  /api/rooms/{id}/stats                   DM: latency of every hop
//!
//! The session journal (see journal.rs), DM only:
//!   GET  /api/rooms/{id}/journal?re&kind&who&since&limit   lines, oldest first
//!   POST /api/rooms/{id}/journal                 { verb: wish|parse, text, re? } → one line
//!   GET  /api/rooms/{id}/review                  the post-mortem report
//!   anything else                                static files from kernel/web

mod inbox;
mod journal;
mod store;

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use inbox::{now_ms, Inbox};
use journal::{quote, short, Entry, Filter, Journal};
use store::Store;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, StreamExt};
use kernel_core::timeline::Input;
use kernel_core::view::event_text;
use kernel_core::{preview_lines, script, step_line, Codex, Command, Handle, Observer, Room, RoomDef, RoomState, RoomView, Step, StepId, StepView, Surgery};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{broadcast, mpsc, oneshot, Notify};
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::ServeDir;

/// One message on a room's push channel, already rendered for each observer. An observer with
/// no entry isn't told.
struct Push {
    name: &'static str,
    bodies: BTreeMap<Observer, String>,
}

struct Hosted {
    room: Room,
    tx: broadcast::Sender<Arc<Push>>,
    inbox: Inbox,
    journal: Journal,
    /// Wakes a waiting DM when a message arrives.
    notify: Arc<Notify>,
    /// Where the room is saved after every request; none if the disk wouldn't have it.
    store: Option<Store>,
}

/// How long a wake waits for more messages to join the batch once the first arrives.
const BATCH_WINDOW: Duration = Duration::from_millis(250);

impl Hosted {
    fn new(room: Room, inbox: Inbox, journal: Journal, store: Option<Store>) -> Self {
        Self { room, tx: broadcast::channel(256).0, inbox, journal, notify: Arc::new(Notify::new()), store }
    }

    /// Writes what the last request changed: new steps, branch heads, the inbox.
    fn save(&mut self) {
        if let Some(store) = &mut self.store {
            if let Err(e) = store.sync(&self.room, &mut self.inbox) {
                eprintln!("room {}: can't save: {e}", self.room.id);
            }
        }
    }

    /// `re=m3` for a step or refusal the DM tagged, or `re=m3?` guessed: the open message the DM
    /// was shown most recently. Seats act for themselves, so their steps get no guess.
    fn re(&self, obs: &Observer, tagged: Option<u64>) -> Option<String> {
        match tagged {
            Some(n) => Some(format!("m{n}")),
            None if *obs == Observer::Dm => self.inbox.guess().map(|n| format!("m{n}?")),
            None => None,
        }
    }

    /// Sends one seat a notice about one of its messages.
    fn tell(&self, seat: &Handle, body: serde_json::Value) {
        let bodies = BTreeMap::from([(Observer::Seat(seat.clone()), body.to_string())]);
        let _ = self.tx.send(Arc::new(Push { name: "notice", bodies }));
    }

    /// Renders a new step once per observer and sends it down the channel.
    fn publish(&self, step: &Step) {
        let s = self.room.state();
        let bodies = s.observers().filter_map(|o| StepView::new(s, &o, step).map(|v| (o, serde_json::to_string(&v).unwrap()))).collect();
        let _ = self.tx.send(Arc::new(Push { name: "step", bodies }));
    }

    /// Tells every client that history changed under them, so they reload.
    fn reset(&self) {
        let body = json!({ "seq": self.room.seq() }).to_string();
        let bodies = self.room.state().observers().map(|o| (o, body.clone())).collect();
        let _ = self.tx.send(Arc::new(Push { name: "reset", bodies }));
    }
}

/// A request for a room's task: runs on its `Hosted`, alone, then the room is saved.
type Job = Box<dyn FnOnce(&mut Hosted) + Send>;

/// How handlers reach a room. Each room is one task that owns its `Hosted` and runs requests one at
/// a time from a queue, so nothing locks and one room never waits on another.
struct RoomHandle {
    jobs: mpsc::UnboundedSender<Job>,
    /// Shared with the room's `Hosted`, so `wait` can sleep without occupying the task.
    notify: Arc<Notify>,
}

impl RoomHandle {
    fn spawn(mut hosted: Hosted) -> Self {
        let (jobs, mut queue) = mpsc::unbounded_channel::<Job>();
        let notify = hosted.notify.clone();
        tokio::spawn(async move {
            while let Some(job) = queue.recv().await {
                job(&mut hosted);
                hosted.save();
            }
        });
        Self { jobs, notify }
    }

    /// Runs `f` on the room and returns what it returns.
    async fn call<R: Send + 'static>(&self, f: impl FnOnce(&mut Hosted) -> R + Send + 'static) -> R {
        let (done, result) = oneshot::channel();
        let job: Job = Box::new(move |h| {
            let _ = done.send(f(h));
        });
        self.jobs.send(job).unwrap_or_else(|_| panic!("the room's task has stopped"));
        result.await.expect("the room's task stopped mid-request")
    }
}

type Rooms = Arc<BTreeMap<String, RoomHandle>>;

fn kernel_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The `*.json` files in a directory, in name order.
fn json_files(dir: &FsPath) -> Vec<PathBuf> {
    let entries = std::fs::read_dir(dir).unwrap_or_else(|e| panic!("can't read {}: {e}", dir.display()));
    let mut files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    files.sort();
    files
}

fn read_json<T: serde::de::DeserializeOwned>(path: &FsPath) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Merges every `codex/*.json`, in name order.
fn load_codex(dir: &FsPath) -> Codex {
    let mut codex = Codex::default();
    for path in json_files(dir) {
        match read_json::<Codex>(&path) {
            Ok(c) => codex.merge(c),
            Err(e) => panic!("bad codex file {}: {e}", path.display()),
        }
    }
    println!("codex: {} identities, {} mark kinds", codex.identities.len(), codex.marks.len());
    codex
}

/// Opens every room that has a file in `rooms/` or a save in `saves/`. A saved room is loaded from
/// its save (its own copy of the definition and codex), so editing `rooms/<id>.json` changes
/// nothing until the save folder is deleted.
fn load_rooms(dir: &FsPath, codex: &Codex, saves: &FsPath) -> BTreeMap<String, Hosted> {
    let mut ids: Vec<String> = json_files(dir).iter().map(|p| p.file_stem().unwrap().to_string_lossy().into_owned()).collect();
    for entry in std::fs::read_dir(saves).into_iter().flatten().flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        if store::exists(&entry.path()) && !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids.sort();
    let mut rooms = BTreeMap::new();
    for id in ids {
        let save_dir = saves.join(&id);
        let opened = if store::exists(&save_dir) {
            Store::load(&save_dir, &id).map(|(store, loaded)| (loaded.room, loaded.inbox, Some(store), true))
        } else {
            read_json::<RoomDef>(&dir.join(format!("{id}.json")))
                .and_then(|def| Room::open(id.clone(), def, codex.clone()))
                .map(|room| match Store::create(&save_dir, &room) {
                    Ok(store) => (room, Inbox::default(), Some(store), false),
                    Err(e) => {
                        eprintln!("room {id}: can't save to {} ({e}); keeping it in memory", save_dir.display());
                        (room, Inbox::default(), None, false)
                    }
                })
        };
        match opened {
            Ok((room, inbox, store, resumed)) => {
                let journal = Journal::open(&save_dir, &id, &room.state().name).unwrap_or_else(|e| {
                    eprintln!("room {id}: no journal on disk ({e}); keeping it in memory");
                    Journal::memory(&id)
                });
                let how = if resumed { format!("resumed at #{} with {} messages", room.seq(), inbox.all().count()) } else { "opened fresh".into() };
                let at = if store.is_some() { save_dir.display().to_string() } else { "in memory".into() };
                println!("room {id}: {} · {how} · saved in {at}", room.state().name);
                rooms.insert(id, Hosted::new(room, inbox, journal, store));
            }
            Err(e) => eprintln!("skipping room {id}: {e}"),
        }
    }
    rooms
}

fn error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "ok": false, "reason": msg.into() }))).into_response()
}

fn no_room(id: &str) -> Response {
    error(StatusCode::NOT_FOUND, format!("no room called {id}"))
}

/// A refusal from a helper, turned into a response by `tri!`.
struct Fail(StatusCode, String);

impl IntoResponse for Fail {
    fn into_response(self) -> Response {
        error(self.0, self.1)
    }
}

/// `as` → observer: `dm` (or nothing) is the DM, anything else must be one of the room's seats.
fn observer(s: &RoomState, who: Option<&str>) -> Result<Observer, Fail> {
    match who {
        None | Some("dm") => Ok(Observer::Dm),
        Some(name) => Handle::new(name)
            .ok()
            .filter(|h| s.seats.contains_key(h))
            .map(Observer::Seat)
            .ok_or_else(|| Fail(StatusCode::NOT_FOUND, format!("this room has no seat called {name}"))),
    }
}

fn dm_only(s: &RoomState, who: Option<&str>) -> Result<(), Fail> {
    match observer(s, who)? {
        Observer::Dm => Ok(()),
        Observer::Seat(_) => Err(Fail(StatusCode::FORBIDDEN, "only the DM can do that".into())),
    }
}

/// Unwraps a `Result<T, Fail>`, returning the refusal from the handler on error.
macro_rules! tri {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(r) => return r.into_response(),
        }
    };
}

#[derive(Deserialize)]
struct Query_ {
    #[serde(rename = "as")]
    who: Option<String>,
    since: Option<u64>,
    limit: Option<usize>,
    branch: Option<String>,
}

#[derive(Deserialize)]
struct AsOnly {
    #[serde(rename = "as")]
    who: Option<String>,
}

async fn list_rooms(State(rooms): State<Rooms>) -> Json<serde_json::Value> {
    let mut list = Vec::new();
    for (id, room) in rooms.iter() {
        let id = id.clone();
        list.push(room.call(move |h| json!({ "id": id, "name": h.room.state().name, "seats": h.room.state().seats.keys().collect::<Vec<_>>() })).await);
    }
    Json(json!(list))
}

async fn get_room(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        let obs = tri!(observer(h.room.state(), q.who.as_deref()));
        Json(RoomView::new(&h.room, &obs)).into_response()
        })
        .await
}

/// Commands as JSON (`commands`) or in the short text form (`script`, see kernel_core::script).
/// `re` names the message the step resolves (`3`, `m3`), for the journal.
#[derive(Deserialize)]
struct Batch {
    #[serde(rename = "as")]
    who: Option<String>,
    gist: Option<String>,
    commands: Option<Vec<Command<String>>>,
    script: Option<String>,
    #[serde(default)]
    dry_run: bool,
    re: Option<String>,
}

fn observer_name(obs: &Observer) -> String {
    match obs {
        Observer::Dm => "dm".into(),
        Observer::Seat(h) => h.to_string(),
    }
}

/// `3`, `m3` or `#3` → 3, if the inbox has that message.
fn message_ref(inbox: &Inbox, re: Option<&str>) -> Result<Option<u64>, Fail> {
    let Some(re) = re.filter(|r| !r.is_empty()) else { return Ok(None) };
    let n = re.trim_start_matches(['m', '#']).parse::<u64>().map_err(|_| Fail(StatusCode::BAD_REQUEST, format!("re: \"{re}\" isn't a message (try 3 or m3)")))?;
    match inbox.get(n) {
        Some(_) => Ok(Some(n)),
        None => Err(Fail(StatusCode::NOT_FOUND, format!("there is no message m{n}"))),
    }
}

/// The command a parse error says doesn't exist, if that's what it says.
fn missing_command(err: &str) -> Option<String> {
    let rest = &err[err.find("command \"")? + 9..];
    Some(rest[..rest.find('"')?].to_owned())
}

/// A parse error's journal line, with the missing command as a fact when there is one. `what` is
/// what was tried (`act "shove grub east"`); a one-statement script's error loses the repeated
/// statement and the syntax reminder: `act "shove grub east": unknown command "shove"`.
fn parse_entry(actor: String, what: String, script: &str, err: &str) -> Entry {
    let short = err.split(" (commands: ").next().unwrap_or(err);
    let short = short.strip_prefix(&format!("`{}`: ", script.trim())).unwrap_or(short);
    let e = Entry::new("?", "parse", actor, format!("{what}: {short}"));
    match missing_command(err) {
        Some(m) => e.fact("missing", m),
        None => e,
    }
}

/// A step's journal payload: `"gist" — what happened`, in the DM's names.
fn step_payload(s: &RoomState, step: &Step) -> String {
    let events: Vec<String> = step.events().iter().filter_map(|e| event_text(s, &Observer::Dm, e)).collect();
    let gist = step.gist.as_deref().map(|g| format!("{} ", quote(g))).unwrap_or_default();
    format!("{gist}— {}", if events.is_empty() { "nothing happens".into() } else { events.join("; ") })
}

/// The seats that control every creature a step moved, if moving is all it did: those players
/// could have made the step themselves.
fn own_moves_of(s: &RoomState, step: &Step) -> Vec<String> {
    let Input::Commands(cmds) = &step.input else { return Vec::new() };
    let movers: Option<Vec<_>> = cmds.iter().map(|c| if let Command::Move { who, .. } = c { Some(*who) } else { None }).collect();
    match movers {
        Some(m) if !m.is_empty() => s.seats.iter().filter(|(_, own)| m.iter().all(|id| own.contains(id))).map(|(h, _)| h.to_string()).collect(),
        _ => Vec::new(),
    }
}

/// Adds `re=…` to an entry when there's something to link it to.
fn tagged(e: Entry, re: &Option<String>) -> Entry {
    match re {
        Some(r) => e.kv("re", r.clone()),
        None => e,
    }
}

async fn post_commands(State(rooms): State<Rooms>, Path(id): Path<String>, Json(batch): Json<Batch>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        let obs = tri!(observer(h.room.state(), batch.who.as_deref()));
        let actor = observer_name(&obs);
        let re = h.re(&obs, tri!(message_ref(&h.inbox, batch.re.as_deref())));
        let (commands, text) = match (batch.commands, batch.script) {
            (Some(c), None) => {
                let text = script::write(&c);
                (c, text)
            }
            (None, Some(s)) => match script::parse(&s) {
                Ok(c) => (c, s.trim().to_owned()),
                Err(e) => {
                    h.journal.record(tagged(parse_entry(actor, format!("act {}", quote(s.trim())), &s, &e), &re));
                    return error(StatusCode::UNPROCESSABLE_ENTITY, e);
                }
            },
            _ => return error(StatusCode::BAD_REQUEST, "send either `commands` or `script`"),
        };
        let started = Instant::now();
        let result = h.room.execute(&obs, &commands, batch.gist, batch.dry_run);
        let took = started.elapsed();
        h.inbox.record_exec(took);
        match result {
            Ok(step) => {
                let s = h.room.state();
                let (refr, verb) = if batch.dry_run { ("?".to_owned(), "dry") } else { (step.id.to_string(), "step") };
                let places = commands.iter().filter(|c| matches!(c, Command::Place { .. })).count();
                let entry = Entry::new(refr, verb, actor, step_payload(s, &step))
                    .kv("cmd", text)
                    .kv("game", step.time.to_string())
                    .fact("own_moves_of", own_moves_of(s, &step))
                    .fact("places", places);
                h.journal.record(tagged(entry, &re).kv("took", short(took)));
                if !batch.dry_run {
                    h.publish(&step);
                }
                let s = h.room.state();
                Json(json!({ "ok": true, "dry_run": batch.dry_run, "line": step_line(s, &obs, &step), "step": StepView::new(s, &obs, &step) })).into_response()
            }
            Err(refused) => {
                let reason = h.room.state().explain(&obs, &refused.rejection);
                let code = refused.rejection.code();
                let entry = Entry::new("?", "refused", actor, format!("{}: {reason}", quote(&text))).kv("code", code).kv("cmd", (refused.index + 1).to_string());
                h.journal.record(tagged(entry, &re));
                (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "ok": false, "index": refused.index, "code": code, "reason": reason }))).into_response()
            }
        }
        })
        .await
}

/// The last steps of a branch as one line each, in the asker's names. Seats only see main.
async fn history(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        let s = h.room.state();
        let obs = tri!(observer(s, q.who.as_deref()));
        if obs != Observer::Dm && q.branch.as_deref().is_some_and(|b| b != "main") {
            return error(StatusCode::FORBIDDEN, "only the DM can read other branches");
        }
        let steps = match h.room.history(q.branch.as_deref(), q.limit.unwrap_or(20)) {
            Ok(s) => s,
            Err(e) => return error(StatusCode::NOT_FOUND, e),
        };
        let lines: Vec<String> = steps.iter().filter_map(|st| step_line(s, &obs, st)).collect();
        Json(json!({ "branch": q.branch.as_deref().unwrap_or("main"), "head": h.room.seq(), "lines": lines })).into_response()
        })
        .await
}

async fn branches(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), q.who.as_deref()));
        let list: Vec<_> = h.room.timeline().branches().map(|(name, b)| json!({ "name": name, "head": b.head, "gist": b.gist })).collect();
        Json(json!(list)).into_response()
        })
        .await
}

/// An edit to history. Commands may come as JSON (`commands`) or as a `script`.
#[derive(Deserialize)]
struct SurgeryReq {
    #[serde(rename = "as")]
    who: Option<String>,
    gist: Option<String>,
    script: Option<String>,
    re: Option<String>,
    #[serde(flatten)]
    op: serde_json::Map<String, serde_json::Value>,
}

async fn surgery(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<SurgeryReq>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        let re = h.re(&Observer::Dm, tri!(message_ref(&h.inbox, req.re.as_deref())));
        let mut op = req.op;
        let name = op.get("op").and_then(|o| o.as_str()).unwrap_or("?").to_owned();
        // `after=#12` or `step=#12`, for the line.
        let target = ["after", "step"].into_iter().find_map(|k| op.get(k).map(|v| (k, format!("#{}", v.to_string().trim_matches('"').trim_start_matches('#')))));
        let with_target = |e: Entry| match &target {
            Some((k, v)) => e.kv(k, v.clone()),
            None => e,
        };
        if let Some(text) = &req.script {
            match script::parse(text) {
                Ok(c) => {
                    op.insert("commands".into(), json!(c));
                }
                Err(e) => {
                    h.journal.record(tagged(with_target(parse_entry("dm".into(), format!("{name} {}", quote(text.trim())), text, &e)), &re));
                    return error(StatusCode::UNPROCESSABLE_ENTITY, e);
                }
            }
        }
        let op: Surgery = match serde_json::from_value(serde_json::Value::Object(op)) {
            Ok(op) => op,
            Err(e) => return error(StatusCode::BAD_REQUEST, format!("not a surgery: {e}")),
        };
        match h.room.surgery(op, req.gist.clone()) {
            Ok(p) => {
                let lines = preview_lines(&h.room, &p.changes);
                let gist = req.gist.as_deref().map(|g| format!(" {}", quote(g))).unwrap_or_default();
                let mut entry = with_target(Entry::new(p.branch.clone(), "preview", "dm", format!("{name}{gist}: {}", lines[0])));
                if let Some(t) = &req.script {
                    entry = entry.kv("cmd", t.trim());
                }
                h.journal.record(tagged(entry, &re).fact("op", name));
                Json(json!({ "ok": true, "branch": p.branch, "base": p.base, "head": p.head, "summary": lines[0], "lines": &lines[1..] })).into_response()
            }
            Err(e) => {
                h.journal.record(tagged(with_target(Entry::new("?", "refused", "dm", format!("{name}: {e}")).kv("code", "surgery")), &re));
                error(StatusCode::UNPROCESSABLE_ENTITY, e)
            }
        }
        })
        .await
}

async fn commit(State(rooms): State<Rooms>, Path((id, name)): Path<(String, String)>, Json(req): Json<AsOnly>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        match h.room.commit(&name) {
            Ok(changes) => {
                h.reset();
                let lines = preview_lines(&h.room, &changes);
                let entry = Entry::new(name.clone(), "commit", "dm", format!("replayed: {}", lines[0])).kv("main", format!("#{}", h.room.seq())).kv("kept", format!("before-{name}"));
                h.journal.record(entry);
                Json(json!({ "ok": true, "head": h.room.seq(), "kept_as": format!("before-{name}"), "replayed": lines })).into_response()
            }
            Err(e) => {
                h.journal.record(Entry::new("?", "refused", "dm", format!("commit {name}: {e}")).kv("code", "branch"));
                error(StatusCode::UNPROCESSABLE_ENTITY, e)
            }
        }
        })
        .await
}

async fn discard(State(rooms): State<Rooms>, Path((id, name)): Path<(String, String)>, Json(req): Json<AsOnly>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        match h.room.discard(&name) {
            Ok(()) => {
                h.journal.record(Entry::new(name, "discard", "dm", "-"));
                Json(json!({ "ok": true })).into_response()
            }
            Err(e) => {
                h.journal.record(Entry::new("?", "refused", "dm", format!("discard {name}: {e}")).kv("code", "branch"));
                error(StatusCode::NOT_FOUND, e)
            }
        }
        })
        .await
}

#[derive(Deserialize)]
struct Rewind {
    #[serde(rename = "as")]
    who: Option<String>,
    step: StepId,
}

async fn post_rewind(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<Rewind>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        let from = h.room.seq();
        match h.room.rewind_to(req.step) {
            Ok(saved) => {
                h.reset();
                h.journal.record(Entry::new(req.step.to_string(), "rewind", "dm", format!("main back to {}", req.step)).kv("from", format!("#{from}")).kv("kept", saved.clone()));
                Json(json!({ "ok": true, "head": h.room.seq(), "kept_as": saved })).into_response()
            }
            Err(why) => {
                h.journal.record(Entry::new("?", "refused", "dm", format!("rewind {}: {why}", req.step)).kv("code", "branch"));
                error(StatusCode::UNPROCESSABLE_ENTITY, why)
            }
        }
        })
        .await
}

#[derive(Deserialize)]
struct NewMessage {
    #[serde(rename = "as")]
    who: Option<String>,
    text: String,
    at: Option<String>,
}

/// A seat tells the DM something. It's acknowledged at once, and wakes a waiting DM.
async fn post_message(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<NewMessage>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        let Observer::Seat(seat) = tri!(observer(h.room.state(), req.who.as_deref())) else {
            return error(StatusCode::BAD_REQUEST, "messages come from a seat; the DM replies with dm reply");
        };
        if req.text.trim().is_empty() {
            return error(StatusCode::BAD_REQUEST, "say something");
        }
        let at = req.at.filter(|a| !a.is_empty());
        let n = h.inbox.add(seat.clone(), req.text.trim().to_owned(), at.clone());
        let mut entry = Entry::new(format!("m{n}"), "sent", seat.to_string(), quote(req.text.trim())).fact("msg", n);
        if let Some(at) = at {
            // Their name for it → the DM's, so the line reads in the DM's names too.
            let s = h.room.state();
            let id = s.names.get(&Observer::Seat(seat.clone())).and_then(|names| names.resolve(&at));
            let dm = id.and_then(|id| s.names.get(&Observer::Dm)?.of(id)).map(|a| a.handle.to_string());
            entry = entry.kv("at", dm.map_or_else(|| at.clone(), |d| format!("{at}→{d}")));
        }
        h.journal.record(entry);
        h.tell(&seat, json!({ "msg": n, "kind": "sent", "text": "Sent to the DM." }));
        h.notify.notify_waiters();
        Json(json!({ "ok": true, "id": n })).into_response()
        })
        .await
}

async fn list_messages(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        let obs = tri!(observer(h.room.state(), q.who.as_deref()));
        let list: Vec<_> = h
            .inbox
            .all()
            .filter(|m| matches!(&obs, Observer::Dm) || matches!(&obs, Observer::Seat(s) if *s == m.from))
            .map(|m| {
                let status = if m.done.is_some() { "done" } else if m.delivered.is_some() { "reading" } else { "sent" };
                json!({ "id": m.id, "from": m.from, "text": m.text, "at": m.at, "status": status, "replies": m.replies })
            })
            .collect();
        Json(json!(list)).into_response()
        })
        .await
}

#[derive(Deserialize)]
struct WaitQuery {
    #[serde(rename = "as")]
    who: Option<String>,
    timeout: Option<u64>,
}

/// The DM's wake. Blocks until at least one message is unseen, waits a moment for others to join
/// the batch, then returns them all with a context bundle. Each sender is told the DM is reading.
async fn wait(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<WaitQuery>) -> Response {
    let called = now_ms();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(q.timeout.unwrap_or(300).min(3600));
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    let who = q.who;
    let allowed = room.call(move |h| dm_only(h.room.state(), who.as_deref())).await;
    tri!(allowed);
    // The waiting happens here, off the room's task, so the room keeps serving while the DM sleeps.
    let notify = room.notify.clone();
    loop {
        let notified = notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable(); // registered before checking, so a message arriving now isn't missed
        if room.call(|h| h.inbox.undelivered()).await == 0 {
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return Json(json!({ "timeout": true, "text": "TIMEOUT: nothing for the DM yet" })).into_response();
            }
            continue;
        }
        tokio::time::sleep(BATCH_WINDOW).await;
        let woke = room
            .call(move |h| {
                let ids = h.inbox.deliver();
                if ids.is_empty() {
                    return None; // another waiter took them
                }
                let text = inbox::bundle(&h.room, &ids, &h.inbox);
                let now = now_ms();
                let oldest = h.inbox.all().filter(|m| ids.contains(&m.id)).map(|m| m.received).min().unwrap_or(now);
                let span = |a: i64, b: i64| Duration::from_millis((b - a).max(0) as u64);
                let w = h.journal.next_wake();
                let refs = ids.iter().map(|n| format!("m{n}")).collect::<Vec<_>>().join(",");
                // `late`: messages were already waiting when the DM called; `idle`: the DM waited for them.
                let (k, d) = if oldest < called { ("late", span(oldest, called)) } else { ("idle", span(called, oldest)) };
                h.journal.record(Entry::new(w, "wake", "dm", refs).kv("batch", ids.len().to_string()).kv("waited", short(span(oldest, now))).kv(k, short(d)).fact("msgs", ids.clone()));
                for m in h.inbox.all().filter(|m| ids.contains(&m.id)) {
                    h.tell(&m.from, json!({ "msg": m.id, "kind": "reading", "text": "The DM is reading…" }));
                }
                Some(Json(json!({ "timeout": false, "ids": ids, "text": text })).into_response())
            })
            .await;
        if let Some(response) = woke {
            return response;
        }
    }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(rename = "as")]
    who: Option<String>,
    text: String,
    #[serde(default)]
    done: bool,
}

async fn reply(State(rooms): State<Rooms>, Path((id, n)): Path<(String, String)>, Json(req): Json<Reply>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        let Ok(n) = n.trim_start_matches('#').parse::<u64>() else { return error(StatusCode::BAD_REQUEST, "messages are numbered: reply 3") };
        let Some(m) = h.inbox.get_mut(n) else { return error(StatusCode::NOT_FOUND, format!("there is no message #{n}")) };
        let now = now_ms();
        m.delivered.get_or_insert(now);
        m.first_reply.get_or_insert(now);
        if req.done {
            m.done = Some(now);
        }
        m.replies.push(req.text.clone());
        let seat = m.from.clone();
        let since = short(Duration::from_millis((now - m.received).max(0) as u64));
        h.journal.record(Entry::new(format!("m{n}"), "reply", "dm", quote(&req.text)).kv("after", since.clone()).fact("msg", n));
        if req.done {
            h.journal.record(Entry::new(format!("m{n}"), "done", "dm", "-").kv("total", since).fact("msg", n));
        }
        h.tell(&seat, json!({ "msg": n, "kind": "reply", "text": req.text, "done": req.done }));
        Json(json!({ "ok": true })).into_response()
        })
        .await
}

async fn pending(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), q.who.as_deref()));
        Json(json!({ "unseen": h.inbox.undelivered(), "open": h.inbox.open() })).into_response()
        })
        .await
}

async fn stats(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), q.who.as_deref()));
        Json(json!({ "text": h.inbox.stats() })).into_response()
        })
        .await
}

#[derive(Deserialize)]
struct JournalQuery {
    #[serde(rename = "as")]
    asker: Option<String>,
    re: Option<String>,
    kind: Option<String>,
    who: Option<String>,
    since: Option<String>,
    limit: Option<usize>,
}

async fn get_journal(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<JournalQuery>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), q.asker.as_deref()));
        let lines = h.journal.query(&Filter { re: q.re, kind: q.kind, who: q.who, since: q.since, limit: q.limit });
        Json(json!({ "lines": lines, "dir": h.journal.dir })).into_response()
        })
        .await
}

/// A line the DM adds: a `wish` for a tool it didn't have, or a `parse` error from the `dm` tool.
#[derive(Deserialize)]
struct JournalNote {
    #[serde(rename = "as")]
    who: Option<String>,
    verb: String,
    text: String,
    re: Option<String>,
}

async fn post_journal(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<JournalNote>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), req.who.as_deref()));
        let text = req.text.trim();
        if text.is_empty() {
            return error(StatusCode::BAD_REQUEST, "say what");
        }
        let entry = match req.verb.as_str() {
            "wish" => Entry::new("?", "wish", "dm", quote(text)),
            "parse" => {
                let (what, err) = text.split_once(": ").unwrap_or((text, ""));
                parse_entry("dm".into(), what.to_owned(), "", err)
            }
            other => return error(StatusCode::BAD_REQUEST, format!("the DM can add wish or parse lines, not \"{other}\"")),
        };
        let re = tri!(message_ref(&h.inbox, req.re.as_deref())).map(|n| format!("m{n}"));
        let entry = tagged(entry, &re);
        let line = entry.line();
        h.journal.record(entry);
        Json(json!({ "ok": true, "line": line })).into_response()
        })
        .await
}

async fn review(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<AsOnly>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    room
        .call(move |h| {
        tri!(dm_only(h.room.state(), q.who.as_deref()));
        Json(json!({ "text": h.journal.review() })).into_response()
        })
        .await
}

fn sse(name: &str, data: &str) -> Result<SseEvent, Infallible> {
    Ok(SseEvent::default().event(name).data(data))
}

/// Missed steps first, then live ones, each as this observer sees it. Subscribing and reading the
/// backlog in the same call on the room's task means nothing falls between them. A client that falls
/// too far behind is told to resync.
async fn stream(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let Some(room) = rooms.get(&id) else { return no_room(&id) };
    let subscribed = room
        .call(move |h| {
            let s = h.room.state();
            let obs = observer(s, q.who.as_deref())?;
            let rx = h.tx.subscribe();
            let backlog: Vec<String> = q
                .since
                .map(|since| h.room.steps_since(since).into_iter().filter_map(|st| StepView::new(s, &obs, st)).map(|v| serde_json::to_string(&v).unwrap()).collect())
                .unwrap_or_default();
            Ok::<_, Fail>((obs, rx, backlog))
        })
        .await;
    let (obs, rx, backlog): (Observer, broadcast::Receiver<Arc<Push>>, Vec<String>) = tri!(subscribed);

    let missed = stream::iter(backlog).map(|body| sse("step", &body));
    let live = BroadcastStream::new(rx).filter_map(move |msg| {
        let out = match msg {
            Ok(p) => p.bodies.get(&obs).map(|body| sse(p.name, body)),
            Err(_lagged) => Some(sse("reset", "{}")),
        };
        std::future::ready(out)
    });
    Sse::new(missed.chain(live)).keep_alive(KeepAlive::default()).into_response()
}

#[tokio::main]
async fn main() {
    let dir = kernel_dir();
    let codex = load_codex(&dir.join("codex"));
    let saves = std::env::var("KERNEL_SAVES").map_or_else(|_| dir.join("saves"), PathBuf::from);
    // Canonical, for a readable path in the startup line (without Windows' `\\?\` prefix).
    let saves = std::fs::create_dir_all(&saves).and_then(|_| saves.canonicalize()).map_or(saves, |p| PathBuf::from(p.display().to_string().trim_start_matches(r"\\?\")));
    let rooms: Rooms = Arc::new(load_rooms(&dir.join("rooms"), &codex, &saves).into_iter().map(|(id, hosted)| (id, RoomHandle::spawn(hosted))).collect());

    let app = Router::new()
        .route("/api/rooms", get(list_rooms))
        .route("/api/rooms/{id}", get(get_room))
        .route("/api/rooms/{id}/commands", post(post_commands))
        .route("/api/rooms/{id}/history", get(history))
        .route("/api/rooms/{id}/branches", get(branches))
        .route("/api/rooms/{id}/surgery", post(surgery))
        .route("/api/rooms/{id}/branches/{name}/commit", post(commit))
        .route("/api/rooms/{id}/branches/{name}/discard", post(discard))
        .route("/api/rooms/{id}/rewind", post(post_rewind))
        .route("/api/rooms/{id}/stream", get(stream))
        .route("/api/rooms/{id}/messages", get(list_messages).post(post_message))
        .route("/api/rooms/{id}/messages/{n}/reply", post(reply))
        .route("/api/rooms/{id}/wait", get(wait))
        .route("/api/rooms/{id}/pending", get(pending))
        .route("/api/rooms/{id}/stats", get(stats))
        .route("/api/rooms/{id}/journal", get(get_journal).post(post_journal))
        .route("/api/rooms/{id}/review", get(review))
        .fallback_service(ServeDir::new(dir.join("web")))
        .with_state(rooms);

    let port: u16 = std::env::var("KERNEL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5180);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("bind");
    println!("battlemap: http://localhost:{port}/");
    axum::serve(listener, app).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lines_name_the_missing_command_once() {
        let err = script::parse("shove grub east").unwrap_err();
        let e = parse_entry("dm".into(), "act \"shove grub east\"".into(), "shove grub east", &err);
        assert_eq!(e.payload, "act \"shove grub east\": unknown command \"shove\"");
        assert_eq!(e.facts["missing"], "shove");
        // Several statements: which one failed stays in.
        let err = script::parse("move rook 4,5; jump rook 3,3").unwrap_err();
        let e = parse_entry("dm".into(), "act \"…\"".into(), "move rook 4,5; jump rook 3,3", &err);
        assert_eq!(e.payload, "act \"…\": `jump rook 3,3`: unknown command \"jump\"");
        assert_eq!(missing_command("a square is two numbers, x,y"), None);
    }
}
