use serde::{Deserialize, Serialize};

use crate::geom::Cell;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CreatureId(pub String);

impl std::fmt::Display for CreatureId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for CreatureId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Creature {
    pub id: CreatureId,
    pub name: String,
    pub side: Side,
    pub pos: Cell,
    pub speed_ft: u32,
    pub hp: i32,
    pub max_hp: i32,
}
