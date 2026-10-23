//! One observer's names for things.
//!
//! For now a handle points straight at the truth. When perception arrives it will point at the
//! observer's *belief* about a thing, which may be wrong (two beliefs for one creature, or one for
//! two), and resolving a handle will go handle → belief → truth.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::id::{EntityId, Handle};

/// How an observer knows something: what they call it, and how they'd describe it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Acquaintance {
    pub handle: Handle,
    /// "Snikka" to someone who knows her name; "goblin" to someone who doesn't.
    pub label: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Names {
    by_handle: BTreeMap<Handle, EntityId>,
    of: BTreeMap<EntityId, Acquaintance>,
}

impl Names {
    /// Gives `id` a handle based on `hint` (`goblin`, then `goblin-2`, …) unless it already has one.
    pub fn learn(&mut self, id: EntityId, hint: Handle, label: String) -> &Acquaintance {
        if !self.of.contains_key(&id) {
            let handle = (1..)
                .map(|n| if n == 1 { hint.clone() } else { hint.numbered(n) })
                .find(|h| !self.by_handle.contains_key(h))
                .unwrap();
            self.by_handle.insert(handle.clone(), id);
            self.of.insert(id, Acquaintance { handle, label });
        }
        &self.of[&id]
    }

    pub fn resolve(&self, handle: &str) -> Option<EntityId> {
        Handle::new(handle).ok().and_then(|h| self.by_handle.get(&h).copied())
    }

    pub fn of(&self, id: EntityId) -> Option<&Acquaintance> {
        self.of.get(&id)
    }
}
