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
//!                                                `reset` when history changes under the client
//!   anything else                                static files from kernel/web

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, StreamExt};
use kernel_core::{preview_lines, step_line, Codex, Command, Handle, Observer, Room, RoomDef, RoomState, RoomView, Step, StepId, StepView, Surgery};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{broadcast, RwLock};
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
}

impl Hosted {
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

type Rooms = Arc<RwLock<BTreeMap<String, Hosted>>>;

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

/// Opens every `rooms/*.json`; the file name is the room id.
fn load_rooms(dir: &FsPath, codex: &Codex) -> BTreeMap<String, Hosted> {
    let mut rooms = BTreeMap::new();
    for path in json_files(dir) {
        let id = path.file_stem().unwrap().to_string_lossy().into_owned();
        let opened = read_json::<RoomDef>(&path).and_then(|def| Room::open(id.clone(), def, codex.clone()));
        match opened {
            Ok(room) => {
                println!("room {id}: {}", room.state().name);
                rooms.insert(id, Hosted { room, tx: broadcast::channel(256).0 });
            }
            Err(e) => eprintln!("skipping {}: {e}", path.display()),
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
    let rooms = rooms.read().await;
    Json(json!(rooms
        .iter()
        .map(|(id, h)| json!({ "id": id, "name": h.room.state().name, "seats": h.room.state().seats.keys().collect::<Vec<_>>() }))
        .collect::<Vec<_>>()))
}

async fn get_room(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    let obs = tri!(observer(h.room.state(), q.who.as_deref()));
    Json(RoomView::new(&h.room, &obs)).into_response()
}

#[derive(Deserialize)]
struct Batch {
    #[serde(rename = "as")]
    who: Option<String>,
    gist: Option<String>,
    commands: Vec<Command<String>>,
    #[serde(default)]
    dry_run: bool,
}

async fn post_commands(State(rooms): State<Rooms>, Path(id): Path<String>, Json(batch): Json<Batch>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    let obs = tri!(observer(h.room.state(), batch.who.as_deref()));
    match h.room.execute(&obs, &batch.commands, batch.gist, batch.dry_run) {
        Ok(step) => {
            if !batch.dry_run {
                h.publish(&step);
            }
            let s = h.room.state();
            Json(json!({ "ok": true, "dry_run": batch.dry_run, "line": step_line(s, &obs, &step), "step": StepView::new(s, &obs, &step) })).into_response()
        }
        Err(refused) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "ok": false,
                "index": refused.index,
                "code": refused.rejection.code(),
                "reason": h.room.state().explain(&obs, &refused.rejection),
            })),
        )
            .into_response(),
    }
}

/// The last steps of a branch as one line each, in the asker's names. Seats only see main.
async fn history(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
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
}

async fn branches(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    tri!(dm_only(h.room.state(), q.who.as_deref()));
    let list: Vec<_> = h.room.timeline().branches().map(|(name, b)| json!({ "name": name, "head": b.head, "gist": b.gist })).collect();
    Json(json!(list)).into_response()
}

#[derive(Deserialize)]
struct SurgeryReq {
    #[serde(rename = "as")]
    who: Option<String>,
    gist: Option<String>,
    #[serde(flatten)]
    op: Surgery,
}

async fn surgery(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<SurgeryReq>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    tri!(dm_only(h.room.state(), req.who.as_deref()));
    match h.room.surgery(req.op, req.gist) {
        Ok(p) => {
            let lines = preview_lines(&h.room, &p.changes);
            Json(json!({ "ok": true, "branch": p.branch, "base": p.base, "head": p.head, "summary": lines[0], "lines": &lines[1..] })).into_response()
        }
        Err(e) => error(StatusCode::UNPROCESSABLE_ENTITY, e),
    }
}

async fn commit(State(rooms): State<Rooms>, Path((id, name)): Path<(String, String)>, Json(req): Json<AsOnly>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    tri!(dm_only(h.room.state(), req.who.as_deref()));
    match h.room.commit(&name) {
        Ok(changes) => {
            h.reset();
            let lines = preview_lines(&h.room, &changes);
            Json(json!({ "ok": true, "head": h.room.seq(), "kept_as": format!("before-{name}"), "replayed": lines })).into_response()
        }
        Err(e) => error(StatusCode::UNPROCESSABLE_ENTITY, e),
    }
}

async fn discard(State(rooms): State<Rooms>, Path((id, name)): Path<(String, String)>, Json(req): Json<AsOnly>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    tri!(dm_only(h.room.state(), req.who.as_deref()));
    match h.room.discard(&name) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => error(StatusCode::NOT_FOUND, e),
    }
}

#[derive(Deserialize)]
struct Rewind {
    #[serde(rename = "as")]
    who: Option<String>,
    step: StepId,
}

async fn post_rewind(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<Rewind>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    tri!(dm_only(h.room.state(), req.who.as_deref()));
    match h.room.rewind_to(req.step) {
        Ok(saved) => {
            h.reset();
            Json(json!({ "ok": true, "head": h.room.seq(), "kept_as": saved })).into_response()
        }
        Err(why) => error(StatusCode::UNPROCESSABLE_ENTITY, why),
    }
}

fn sse(name: &str, data: &str) -> Result<SseEvent, Infallible> {
    Ok(SseEvent::default().event(name).data(data))
}

/// Missed steps first, then live ones, each as this observer sees it. Subscribing and reading the
/// backlog under the same lock means nothing falls between them. A client that falls too far
/// behind is told to resync.
async fn stream(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Query_>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    let s = h.room.state();
    let obs = tri!(observer(s, q.who.as_deref()));
    let rx = h.tx.subscribe();
    let backlog: Vec<String> = q
        .since
        .map(|since| h.room.steps_since(since).into_iter().filter_map(|st| StepView::new(s, &obs, st)).map(|v| serde_json::to_string(&v).unwrap()).collect())
        .unwrap_or_default();
    drop(rooms);

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
    let rooms: Rooms = Arc::new(RwLock::new(load_rooms(&dir.join("rooms"), &codex)));

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
        .fallback_service(ServeDir::new(dir.join("web")))
        .with_state(rooms);

    let port: u16 = std::env::var("KERNEL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5180);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("bind");
    println!("battlemap: http://localhost:{port}/");
    axum::serve(listener, app).await.expect("serve");
}
