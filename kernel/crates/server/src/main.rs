//! Hosts kernel rooms over HTTP and pushes their events to browsers over SSE.
//!
//!   GET  /api/rooms                    the rooms on offer
//!   GET  /api/rooms/{id}               the room as a client sees it (RoomView)
//!   POST /api/rooms/{id}/commands      { commands: [Command], dry_run? } → events, atomically
//!   POST /api/rooms/{id}/rewind        { seq } → drop every event after seq
//!   GET  /api/rooms/{id}/stream?since  SSE: missed events since `since`, then live ones
//!   anything else                      static files from kernel/web

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
use kernel_core::{Command, Recorded, Room, RoomDef, RoomView};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::ServeDir;

/// One message on a room's push channel: an SSE event name and its JSON body.
type Push = Arc<(&'static str, String)>;

struct Hosted {
    room: Room,
    tx: broadcast::Sender<Push>,
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
            .and_then(|def| Room::open(id.clone(), def).map_err(|e| e.to_string()));
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

fn no_room(id: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": format!("no room called {id}") }))).into_response()
}

async fn list_rooms(State(rooms): State<Rooms>) -> Json<serde_json::Value> {
    let rooms = rooms.read().await;
    Json(json!(rooms.iter().map(|(id, h)| json!({ "id": id, "name": h.room.state().name })).collect::<Vec<_>>()))
}

async fn get_room(State(rooms): State<Rooms>, Path(id): Path<String>) -> Response {
    let rooms = rooms.read().await;
    match rooms.get(&id) {
        Some(h) => Json(RoomView::of(&h.room)).into_response(),
        None => no_room(&id),
    }
}

#[derive(Deserialize)]
struct Batch {
    commands: Vec<Command>,
    #[serde(default)]
    dry_run: bool,
}

async fn post_commands(State(rooms): State<Rooms>, Path(id): Path<String>, Json(batch): Json<Batch>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    match h.room.execute(&batch.commands, batch.dry_run) {
        Ok(events) => {
            if !batch.dry_run {
                for e in &events {
                    let _ = h.tx.send(Arc::new(("event", serde_json::to_string(e).unwrap())));
                }
            }
            Json(json!({ "ok": true, "dry_run": batch.dry_run, "events": events })).into_response()
        }
        Err((index, why)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "ok": false, "index": index, "reason": why.reason })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct Rewind {
    seq: u64,
}

async fn post_rewind(State(rooms): State<Rooms>, Path(id): Path<String>, Json(req): Json<Rewind>) -> Response {
    let mut rooms = rooms.write().await;
    let Some(h) = rooms.get_mut(&id) else { return no_room(&id) };
    match h.room.rewind_to(req.seq) {
        Ok(()) => {
            let seq = h.room.seq();
            let _ = h.tx.send(Arc::new(("rewind", json!({ "seq": seq }).to_string())));
            Json(json!({ "ok": true, "seq": seq })).into_response()
        }
        Err(why) => (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "ok": false, "reason": why.reason }))).into_response(),
    }
}

#[derive(Deserialize)]
struct Since {
    since: Option<u64>,
}

fn sse(name: &str, data: &str) -> Result<SseEvent, Infallible> {
    Ok(SseEvent::default().event(name).data(data))
}

/// Missed events first, then live ones. Subscribing and reading the backlog under the same lock
/// means nothing falls between them. A client that falls too far behind is told to resync.
async fn stream(State(rooms): State<Rooms>, Path(id): Path<String>, Query(q): Query<Since>) -> Response {
    let rooms = rooms.read().await;
    let Some(h) = rooms.get(&id) else { return no_room(&id) };
    let rx = h.tx.subscribe();
    let backlog: Vec<Recorded> = q.since.map(|s| h.room.events_since(s).to_vec()).unwrap_or_default();
    drop(rooms);

    let missed = stream::iter(backlog).map(|e| sse("event", &serde_json::to_string(&e).unwrap()));
    let live = BroadcastStream::new(rx).map(|msg| match msg {
        Ok(p) => sse(p.0, &p.1),
        Err(_lagged) => sse("resync", "{}"),
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
