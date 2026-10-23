use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::codex::Codex;
use crate::def::RoomDef;
use crate::geom::Cell;
use crate::id::EntityId;

/// A fact that happened in a room. Applying an event never fails: every check ran before it was made.
/// Events name things by id; clients get them through `view::event_view`, in their own names.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Always the first event: the room as authored, and the codex it was opened with (kept in the
    /// log so replay never depends on codex files that may have changed since).
    RoomOpened { def: Arc<RoomDef>, codex: Arc<Codex> },
    /// `path` runs from the square after the start to the destination.
    CreatureMoved { who: EntityId, path: Vec<Cell>, cost_ft: u32 },
    CreaturePlaced { who: EntityId, to: Cell },
}

/// An event with its place in the room's log. `seq` starts at 1 and has no gaps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Recorded {
    pub seq: u64,
    #[serde(flatten)]
    pub event: Event,
}
