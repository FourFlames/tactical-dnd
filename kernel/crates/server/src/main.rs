//! Hosts kernel rooms over HTTP and pushes their events to browsers over SSE.
//! Every request is made as an observer (`as`: `dm`, the default, or a seat's name) and everything
//! sent back is rendered for that observer, in their names.
//!
//!   GET  /api/rooms                         the rooms on offer, with their seats
//!   GET  /api/rooms/{id}?as                 the room as that observer sees it
//!   POST /api/rooms/{id}/commands           { as?, commands: [Command], dry_run? } → events, atomically
//!   POST /api/rooms/{id}/rewind             { seq } → drop every event after seq (DM only)
//!   GET  /api/rooms/{id}/stream?as&since    SSE: missed events since `since`, then live ones
//!   anything else                           static files from kernel/web

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
use kernel_core::{event_view, Command, Handle, Observer, Recorded, Room, RoomDef, RoomState, RoomView};
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
    /// Renders new events once per observer and sends them down the channel.
    fn publish(&self, events: &[Recorded]) {
        let s = self.room.state();
        for e in events {
            let bodies = s
                .observers()
                .filter_map(|o| event_view(s, &o, e).map(|v| (o, serde_json::to_string(&v).unwrap())))
                .collect();
            let _ = self.tx.send(Arc::new(Push { name: "event", bodies }));
        }
    }
}

type Rooms = Arc<RwLock<BTreeMap<String, Hosted>>>;

fn kernel_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Opens every `rooms/*.json`; the file name is the room id.
fn load_rooms(dir: &FsPath) -> BTreeMap<String, Hosted> {
    let mut rooms = BTreeMap::new();
    let entries = std::fs::read_dir(dir).unwrap_or_else(|e| panic!("can't read {}: {e}", dir.display()));
    for path in entries.flatten().map(|e| e.path()) {
        if path.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let id = path.file_stem().unwrap().to_string_lossy().into_owned();
        let opened = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<RoomDef>(&s).map_err(|e| e.to_string()))
            .and_then(|def| Room::open(id.clone(), def));
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

/// `as` → observer: `dm` (or nothing) is the DM, anything else must be one of the room's seats.
fn observer(s: &RoomState, who: Option<&str>) -> Result<Observer, NoSeat> {
    match who {
        None | Some("dm") => Ok(Observer::Dm),
        Some(name) => Handle::new(name).ok().filter(|h| s.seats.contains_key(h)).map(Observer::Seat).ok_or_else(|| NoSeat(name.into())),
    }
}

struct NoSeat(String);

impl IntoResponse for NoSeat {
    fn into_response(self) -> Response {
        error(StatusCode::NOT_FOUND, format!("this room has no seat called {}", self.0))
    }
}

#[derive(Deserialize)]
struct As {
    #[serde(rename = "as")]
    who: Option<String>,
    since: Option<u64>,
}

async fn list_rooms(State(rooms): State<Rooms>) -> Json<serde_json::Value> {
    let rooms = rooms.read().await;
    Json(json!(rooms
        .iter()
        .map(|(id, h)| json!({ "id": id, "name": h.room.state().name, "seats": h.room.state().seats.keys().collect::<Vec<_>>() }))
        .collect::<Vec<_>>()))
}

async fn get_room(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<As>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    match observer(h.room.state(), q.who.as_deref()) {
        Ok(obs) => Json(RoomView::new(&h.room, &obs)).into_response(),
        Err(r) => r.into_response(),
    }
}

#[derive(Deserialize)]
struct Batch {
    #[serde(rename = "as")]
    who: Option<String>,
    commands: Vec<Command<String>>,
    #[serde(default)]
    dry_run: bool,
}

async fn post_commands(State(rooms): State<Rooms>, Path(id): Path<String>, Json(batch): Json<Batch>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    let obs = match observer(h.room.state(), batch.who.as_deref()) {
        Ok(o) => o,
        Err(r) => return r.into_response(),
    };
    match h.room.execute(&obs, &batch.commands, batch.dry_run) {
        Ok(events) => {
            if !batch.dry_run {
                h.publish(&events);
            }
            let s = h.room.state();
            let views: Vec<_> = events.iter().filter_map(|e| event_view(s, &obs, e)).collect();
            Json(json!({ "ok": true, "dry_run": batch.dry_run, "events": views })).into_response()
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

#[derive(Deserialize)]
struct Rewind {
    #[serde(rename = "as")]
    who: Option<String>,
    seq: u64,
}

async fn post_rewind(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<Rewind>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    if !matches!(observer(h.room.state(), req.who.as_deref()), Ok(Observer::Dm)) {
        return error(StatusCode::FORBIDDEN, "only the DM can rewind");
    }
    match h.room.rewind_to(req.seq) {
        Ok(()) => {
            let seq = h.room.seq();
            let body = json!({ "seq": seq }).to_string();
            let bodies = h.room.state().observers().map(|o| (o, body.clone())).collect();
            let _ = h.tx.send(Arc::new(Push { name: "rewind", bodies }));
            Json(json!({ "ok": true, "seq": seq })).into_response()
        }
        Err(why) => error(StatusCode::UNPROCESSABLE_ENTITY, why),
    }
}

fn sse(name: &str, data: &str) -> Result<SseEvent, Infallible> {
    Ok(SseEvent::default().event(name).data(data))
}

/// Missed events first, then live ones, each as this observer sees it. Subscribing and reading the
/// backlog under the same lock means nothing falls between them. A client that falls too far
/// behind is told to resync.
async fn stream(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<As>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    let s = h.room.state();
    let obs = match observer(s, q.who.as_deref()) {
        Ok(o) => o,
        Err(r) => return r.into_response(),
    };
    let rx = h.tx.subscribe();
    let backlog: Vec<String> = q
        .since
        .map(|since| h.room.events_since(since).iter().filter_map(|e| event_view(s, &obs, e)).map(|v| serde_json::to_string(&v).unwrap()).collect())
        .unwrap_or_default();
    drop(rooms);

    let missed = stream::iter(backlog).map(|body| sse("event", &body));
    let live = BroadcastStream::new(rx).filter_map(move |msg| {
        let out = match msg {
            Ok(p) => p.bodies.get(&obs).map(|body| sse(p.name, body)),
            Err(_lagged) => Some(sse("resync", "{}")),
        };
        std::future::ready(out)
    });
    Sse::new(missed.chain(live)).keep_alive(KeepAlive::default()).into_response()
}

#[tokio::main]
async fn main() {
    let dir = kernel_dir();
    let rooms: Rooms = Arc::new(RwLock::new(load_rooms(&dir.join("rooms"))));

    let app = Router::new()
        .route("/api/rooms", get(list_rooms))
        .route("/api/rooms/{id}", get(get_room))
        .route("/api/rooms/{id}/commands", post(post_commands))
        .route("/api/rooms/{id}/rewind", post(post_rewind))
        .route("/api/rooms/{id}/stream", get(stream))
        .fallback_service(ServeDir::new(dir.join("web")))
        .with_state(rooms);

    let port: u16 = std::env::var("KERNEL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5180);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("bind");
    println!("battlemap: http://localhost:{port}/");
    axum::serve(listener, app).await.expect("serve");
}
