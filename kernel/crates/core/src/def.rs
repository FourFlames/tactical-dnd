//! Room definitions: the authored file a room starts from.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::command::Rejection;
use crate::creature::{Creature, CreatureId, Side};
use crate::geom::Cell;
use crate::map::{Map, Terrain};

/// A room as written by hand: `rows` of single-character glyphs, each defined in `legend`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoomDef {
    pub name: String,
    pub legend: BTreeMap<char, Terrain>,
    pub rows: Vec<String>,
    #[serde(default)]
    pub creatures: Vec<CreatureDef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CreatureDef {
    pub id: CreatureId,
    pub name: String,
    pub side: Side,
    pub at: Cell,
    #[serde(default = "default_speed")]
    pub speed_ft: u32,
    pub hp: i32,
}

fn default_speed() -> u32 {
    30
}

impl RoomDef {
    /// Checks the definition and builds the map and creatures it describes.
    pub fn build(&self) -> Result<(Map, BTreeMap<CreatureId, Creature>), Rejection> {
        let height = self.rows.len();
        let width = self.rows.first().map_or(0, |r| r.chars().count());
        if width == 0 || height == 0 {
            return Err(Rejection::new("the room has no rows"));
        }

        let glyphs: Vec<char> = self.legend.keys().copied().collect();
        let mut tiles = Vec::with_capacity(width * height);
        for (y, row) in self.rows.iter().enumerate() {
            if row.chars().count() != width {
                return Err(Rejection::new(format!("row {y} is not {width} squares wide")));
            }
            for ch in row.chars() {
                let i = glyphs
                    .binary_search(&ch)
                    .map_err(|_| Rejection::new(format!("row {y} uses '{ch}', which the legend doesn't define")))?;
                tiles.push(i as u16);
            }
        }
        let map = Map {
            width: width as i32,
            height: height as i32,
            palette: self.legend.values().cloned().collect(),
            tiles,
        };

        let mut creatures = BTreeMap::new();
        let mut taken = HashSet::new();
        for c in &self.creatures {
            if !map.passable(c.at) {
                return Err(Rejection::new(format!("{} starts at {}, which isn't open floor", c.id, c.at)));
            }
            if !taken.insert(c.at) {
                return Err(Rejection::new(format!("{} starts on an occupied square {}", c.id, c.at)));
            }
            let creature = Creature {
                id: c.id.clone(),
                name: c.name.clone(),
                side: c.side,
                pos: c.at,
                speed_ft: c.speed_ft,
                hp: c.hp,
                max_hp: c.hp,
            };
            if creatures.insert(c.id.clone(), creature).is_some() {
                return Err(Rejection::new(format!("two creatures are called {}", c.id)));
            }
        }
        Ok((map, creatures))
    }
}
