use serde::{Deserialize, Serialize};

use crate::creature::CreatureId;
use crate::geom::Cell;

/// Something a player or the DM asks the room to do. Commands may be refused; events may not.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// Walk to `to` along the cheapest legal route, within the creature's speed.
    Move { id: CreatureId, to: Cell },
    /// Put a creature on a square directly (DM fiat: no route, no speed).
    Place { id: CreatureId, to: Cell },
}

/// Why a command was refused, in words a player can read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rejection {
    pub reason: String,
}

impl Rejection {
    pub fn new(reason: impl Into<String>) -> Self {
        Self { reason: reason.into() }
    }
}

impl std::fmt::Display for Rejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.reason)
    }
}

impl std::error::Error for Rejection {}
