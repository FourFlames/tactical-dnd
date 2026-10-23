//! How one creature stands toward another, judged from its own reading of the other's marks.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::codex::{Codex, Facet};
use crate::creature::Creature;
use crate::id::Handle;
use crate::reading::read_passing;

/// Ordered from worst to best, so the most negative of several is the minimum.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stance {
    Hostile,
    Wary,
    Neutral,
    Friendly,
    Deferential,
}

/// The relational identity given to anyone an observer doesn't know personally.
pub const STRANGER: &str = "stranger";

/// Everything `observer` notices of `target` in passing.
pub fn passing_facets(codex: &Codex, observer: &Creature, target: &Creature) -> Vec<Facet> {
    target.marks.iter().flat_map(|m| read_passing(codex, m, &observer.abilities)).collect()
}

/// The identities `observer` reads in `target`, including relational ones.
pub fn identities_seen(codex: &Codex, observer: &Creature, target: &Creature) -> BTreeSet<Handle> {
    let mut ids: BTreeSet<Handle> = passing_facets(codex, observer, target).into_iter().filter_map(|f| f.identity).collect();
    if !observer.acquainted.contains(&target.id) {
        ids.insert(Handle::new(STRANGER).unwrap());
    }
    ids
}

/// A personal relation if there is one; friendly toward someone it knows from its own groups;
/// otherwise its dispositions toward what it reads in the target, the most negative winning
/// (a placeholder rule), neutral if none apply.
pub fn stance(codex: &Codex, observer: &Creature, target: &Creature) -> Stance {
    if let Some(s) = observer.relations.get(&target.id) {
        return *s;
    }
    if observer.acquainted.contains(&target.id) {
        return Stance::Friendly;
    }
    identities_seen(codex, observer, target).iter().filter_map(|id| observer.dispositions.get(id)).copied().min().unwrap_or(Stance::Neutral)
}
