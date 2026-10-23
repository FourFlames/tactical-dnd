use std::collections::{BTreeMap, BTreeSet};

use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::reading::{Abilities, MarkInstance};
use crate::stance::Stance;

/// A creature as the kernel knows it. Nothing here says what it *is* to anyone else: others read
/// that from its marks (see `stance`, `reading`).
#[derive(Clone, Debug, PartialEq)]
pub struct Creature {
    pub id: EntityId,
    /// The true name. Only observers who know it see it.
    pub name: String,
    pub pos: Cell,
    pub speed_ft: u32,
    pub hp: i32,
    pub max_hp: i32,
    /// What others can perceive of it.
    pub marks: Vec<MarkInstance>,
    /// What it takes itself to be: goblin, Rotfang clan, Red Watch.
    pub identities: BTreeSet<Handle>,
    /// What it brings to reading others.
    pub abilities: Abilities,
    /// Its attitude toward identities it reads in others.
    pub dispositions: BTreeMap<Handle, Stance>,
    /// Attitudes toward particular individuals, overriding dispositions.
    pub relations: BTreeMap<EntityId, Stance>,
    /// Individuals it knows personally (for now: fellow members of its groups).
    pub acquainted: BTreeSet<EntityId>,
}
