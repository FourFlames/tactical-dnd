use serde::{Deserialize, Serialize};

use crate::geom::Cell;
use crate::id::EntityId;

/// A fact that happened in a room. Applying an event never fails: every check ran before it was made.
/// Events live inside timeline steps and name things by id; clients get them through `view`, in
/// their own names.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// `path` runs from the square after the start to the destination.
    CreatureMoved { who: EntityId, path: Vec<Cell>, cost_ft: u32 },
    CreaturePlaced { who: EntityId, to: Cell },
    TimePassed { seconds: u64 },
}
