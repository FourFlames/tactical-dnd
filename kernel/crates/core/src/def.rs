//! Room definitions: the authored file a room starts from.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::codex::{Codex, IdentityKind};
use crate::creature::Creature;
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::{Map, Terrain};
use crate::reading::{Abilities, MarkInstance, Skill};
use crate::stance::Stance;

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
    pub at: Cell,
    #[serde(default = "default_speed")]
    pub speed_ft: u32,
    pub hp: i32,
    #[serde(default)]
    pub marks: Vec<MarkInstance>,
    /// What it takes itself to be (codex identities).
    #[serde(default)]
    pub identities: BTreeSet<Handle>,
    #[serde(default)]
    pub knows: BTreeSet<String>,
    #[serde(default)]
    pub skills: BTreeMap<String, Skill>,
    /// Attitudes toward identities (codex identities, including `stranger`).
    #[serde(default)]
    pub dispositions: BTreeMap<Handle, Stance>,
    /// Attitudes toward particular creatures in this room, by key.
    #[serde(default)]
    pub relations: BTreeMap<Handle, Stance>,
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
    /// Checks the definition against the codex and builds what it describes. Errors are for the author.
    pub fn build(&self, codex: &Codex) -> Result<Built, String> {
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

        let keys: Vec<(EntityId, Handle)> = self.creatures.iter().enumerate().map(|(i, c)| (EntityId(i as u32 + 1), c.key.clone())).collect();
        let id_of = |k: &Handle| keys.iter().find(|(_, key)| key == k).map(|(id, _)| *id);
        let identity = |who: &Handle, id: &Handle| {
            if codex.identities.contains_key(id) {
                Ok(())
            } else {
                Err(format!("{who} refers to identity {id}, which the codex doesn't define"))
            }
        };

        let mut creatures = BTreeMap::new();
        let mut taken = HashSet::new();
        for (c, (id, _)) in self.creatures.iter().zip(&keys) {
            if id_of(&c.key) != Some(*id) {
                return Err(format!("two creatures are called {}", c.key));
            }
            if !map.passable(c.at) {
                return Err(format!("{} starts at {}, which isn't open floor", c.key, c.at));
            }
            if !taken.insert(c.at) {
                return Err(format!("{} starts on an occupied square {}", c.key, c.at));
            }
            if let Some(m) = c.marks.iter().find(|m| !codex.marks.contains_key(&m.kind)) {
                return Err(format!("{} has mark {}, which the codex doesn't define", c.key, m.kind));
            }
            for i in c.identities.iter().chain(c.dispositions.keys()) {
                identity(&c.key, i)?;
            }
            let relations = c
                .relations
                .iter()
                .map(|(k, s)| id_of(k).map(|id| (id, *s)).ok_or_else(|| format!("{} has a relation to {k}, who isn't in the room", c.key)))
                .collect::<Result<_, _>>()?;
            let creature = Creature {
                id: *id,
                name: c.name.clone(),
                pos: c.at,
                speed_ft: c.speed_ft,
                hp: c.hp,
                max_hp: c.hp,
                marks: c.marks.clone(),
                identities: c.identities.clone(),
                abilities: Abilities { knows: c.knows.clone(), skills: c.skills.clone() },
                dispositions: c.dispositions.clone(),
                relations,
                acquainted: BTreeSet::new(),
            };
            creatures.insert(*id, creature);
        }

        // Members of the same group know each other.
        let is_group = |h: &Handle| codex.identities.get(h).is_some_and(|d| d.kind == IdentityKind::Group);
        let ids: Vec<EntityId> = creatures.keys().copied().collect();
        for &a in &ids {
            let known: BTreeSet<EntityId> = ids
                .iter()
                .copied()
                .filter(|&b| b != a && creatures[&a].identities.intersection(&creatures[&b].identities).any(is_group))
                .collect();
            creatures.get_mut(&a).unwrap().acquainted = known;
        }

        let mut seats = BTreeMap::new();
        for (seat, controls) in &self.seats {
            let ids = controls
                .iter()
                .map(|k| id_of(k).ok_or_else(|| format!("seat {seat} controls {k}, which isn't in the room")))
                .collect::<Result<BTreeSet<_>, _>>()?;
            seats.insert(seat.clone(), ids);
        }
        Ok(Built { map, creatures, keys, seats })
    }
}
