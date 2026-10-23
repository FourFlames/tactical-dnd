//! Identity and naming. An [`EntityId`] is what the kernel means; a [`Handle`] is what someone calls it.
//! Ids never leave the kernel: every client, the DM included, refers to things by its own handles
//! (see [`crate::names`]).

use std::sync::Arc;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The kernel's identity for a creature (later: any entity). Allocated by the room, never reused,
/// and never shown to anyone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EntityId(pub u32);

/// The kernel's identity for a place (see [`crate::place`]). Like [`EntityId`], it never leaves the kernel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlaceId(pub u32);

/// A short name someone uses to refer to something: lowercase letters, digits and dashes,
/// at most [`Handle::MAX`] long. The DM's might be `snikka`; a player's for the same goblin, `goblin-2`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Handle(Arc<str>);

impl Handle {
    pub const MAX: usize = 24;

    pub fn new(s: &str) -> Result<Self, String> {
        let ok = !s.is_empty()
            && s.len() <= Self::MAX
            && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !s.starts_with('-')
            && !s.ends_with('-');
        if ok {
            Ok(Self(s.into()))
        } else {
            Err(format!("\"{s}\" isn't a valid name: use lowercase letters, digits and dashes, at most {} long", Self::MAX))
        }
    }

    /// A handle made from free text: "Goblin Archer" → `goblin-archer`.
    pub fn slug(text: &str) -> Self {
        let mut s = String::new();
        for ch in text.chars().flat_map(char::to_lowercase) {
            if ch.is_ascii_alphanumeric() {
                s.push(ch);
            } else if !s.is_empty() && !s.ends_with('-') {
                s.push('-');
            }
        }
        s.truncate(Self::MAX);
        let s = s.trim_end_matches('-');
        Self::new(if s.is_empty() { "thing" } else { s }).expect("slug is valid")
    }

    /// `goblin` → `goblin-2`, shortening the base if the result would be too long.
    pub fn numbered(&self, n: u32) -> Self {
        let suffix = format!("-{n}");
        let base = &self.0[..self.0.len().min(Self::MAX - suffix.len())];
        Self::new(&format!("{}{suffix}", base.trim_end_matches('-'))).expect("numbered handle is valid")
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Handle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for Handle {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Handle {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Handle::new(&String::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_numbering() {
        assert_eq!(Handle::slug("Goblin Archer!").as_str(), "goblin-archer");
        assert_eq!(Handle::slug("  ...  ").as_str(), "thing");
        assert_eq!(Handle::slug("goblin").numbered(2).as_str(), "goblin-2");
        let long = Handle::slug("a very long description of a robed figure");
        assert!(long.numbered(12).as_str().len() <= Handle::MAX);
        assert!(Handle::new("Snikka").is_err());
    }
}
