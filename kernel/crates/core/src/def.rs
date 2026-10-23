//! Room definitions: the authored file a room starts from.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::creature::{Creature, Side};
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::{Map, Terrain};

/// A room as written by hand: `rows` of single-character glyphs, each defined in `legend`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoomDef {
    pub name: String,
    pub legend: BTreeMap<char, Terrain>,
    pub rows: Vec<String>,
    #[serde(default)]
    pub creatures: Vec<CreatureDef>,
    /// Player seats and the creatures (by key) each one controls.
    #[serde(default)]
    pub seats: BTreeMap<Handle, Vec<Handle>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CreatureDef {
    /// The author's (and so the DM's) handle for it.
    pub key: Handle,
    pub name: String,
    /// What strangers see. Defaults to the name.
    #[serde(default)]
    pub looks: Option<String>,
    pub side: Side,
    pub at: Cell,
    #[serde(default = "default_speed")]
    pub speed_ft: u32,
    pub hp: i32,
}

fn default_speed() -> u32 {
    30
}

/// What a definition builds into. Ids are given out in the order creatures are listed, from 1.
pub struct Built {
    pub map: Map,
    pub creatures: BTreeMap<EntityId, Creature>,
    pub keys: Vec<(EntityId, Handle)>,
    pub seats: BTreeMap<Handle, BTreeSet<EntityId>>,
}

impl RoomDef {
    /// Checks the definition and builds what it describes. Errors are for the author.
    pub fn build(&self) -> Result<Built, String> {
        let height = self.rows.len();
        let width = self.rows.first().map_or(0, |r| r.chars().count());
        if width == 0 || height == 0 {
            return Err("the room has no rows".into());
        }

        let glyphs: Vec<char> = self.legend.keys().copied().collect();
        let mut tiles = Vec::with_capacity(width * height);
        for (y, row) in self.rows.iter().enumerate() {
            if row.chars().count() != width {
                return Err(format!("row {y} is not {width} squares wide"));
            }
            for ch in row.chars() {
                let i = glyphs.binary_search(&ch).map_err(|_| format!("row {y} uses '{ch}', which the legend doesn't define"))?;
                tiles.push(i as u16);
            }
        }
        let map = Map { width: width as i32, height: height as i32, palette: self.legend.values().cloned().collect(), tiles };

        let mut creatures = BTreeMap::new();
        let mut keys: Vec<(EntityId, Handle)> = Vec::new();
        let mut taken = HashSet::new();
        for (i, c) in self.creatures.iter().enumerate() {
            let id = EntityId(i as u32 + 1);
            if keys.iter().any(|(_, k)| k == &c.key) {
                return Err(format!("two creatures are called {}", c.key));
            }
            if !map.passable(c.at) {
                return Err(format!("{} starts at {}, which isn't open floor", c.key, c.at));
            }
            if !taken.insert(c.at) {
                return Err(format!("{} starts on an occupied square {}", c.key, c.at));
            }
            let looks = c.looks.clone().unwrap_or_else(|| c.name.clone());
            let creature = Creature {
                id,
                name: c.name.clone(),
                looks,
                side: c.side,
                pos: c.at,
                speed_ft: c.speed_ft,
                hp: c.hp,
                max_hp: c.hp,
            };
            creatures.insert(id, creature);
            keys.push((id, c.key.clone()));
        }

        let mut seats = BTreeMap::new();
        for (seat, controls) in &self.seats {
            let ids = controls
                .iter()
                .map(|k| keys.iter().find(|(_, key)| key == k).map(|(id, _)| *id).ok_or_else(|| format!("seat {seat} controls {k}, which isn't in the room")))
                .collect::<Result<BTreeSet<_>, _>>()?;
            seats.insert(seat.clone(), ids);
        }
        Ok(Built { map, creatures, keys, seats })
    }
}
