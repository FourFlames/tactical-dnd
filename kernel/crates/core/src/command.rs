use serde::{Deserialize, Serialize};

use crate::geom::Cell;
use crate::id::EntityId;

/// Something an observer asks the room to do. Commands may be refused; events may not.
///
/// They arrive as `Command<String>`, naming things by the sender's own handles, and are resolved
/// into `Command<EntityId>` for that sender before the rules see them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command<R = EntityId> {
    /// Walk to `to` along the cheapest legal route, within the creature's speed.
    Move { who: R, to: Cell },
    /// Put a creature on a square directly (DM fiat: no route, no speed).
    Place { who: R, to: Cell },
}

/// Why a command was refused. It names things by id, never by text: it's rendered for whoever
/// sent the command (`RoomState::explain`), in their own names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    UnknownName { name: String },
    NotYours { who: EntityId },
    DmOnly,
    OffMap { at: Cell },
    AlreadyThere { who: EntityId, at: Cell },
    Blocked { at: Cell, terrain: String },
    Occupied { at: Cell, by: EntityId },
    NoRoute { who: EntityId, to: Cell },
    TooFar { who: EntityId, to: Cell, cost_ft: u32, speed_ft: u32 },
}

impl Rejection {
    /// A stable code clients can branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Rejection::UnknownName { .. } => "unknown_name",
            Rejection::NotYours { .. } => "not_yours",
            Rejection::DmOnly => "dm_only",
            Rejection::OffMap { .. } => "off_map",
            Rejection::AlreadyThere { .. } => "already_there",
            Rejection::Blocked { .. } => "blocked",
            Rejection::Occupied { .. } => "occupied",
            Rejection::NoRoute { .. } => "no_route",
            Rejection::TooFar { .. } => "too_far",
        }
    }
}
