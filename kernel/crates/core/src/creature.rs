use serde::{Deserialize, Serialize};

use crate::geom::Cell;
use crate::id::EntityId;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Party,
    Hostile,
    Neutral,
}

impl Side {
    /// Whose squares this side can't move through.
    pub fn hostile_to(self, other: Side) -> bool {
        matches!((self, other), (Side::Party, Side::Hostile) | (Side::Hostile, Side::Party))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Creature {
    pub id: EntityId,
    /// The true name. Only observers who know it see it.
    pub name: String,
    /// What a stranger would call it: "goblin", "robed old man".
    pub looks: String,
    pub side: Side,
    pub pos: Cell,
    pub speed_ft: u32,
    pub hp: i32,
    pub max_hp: i32,
}
