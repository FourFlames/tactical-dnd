use serde::{Deserialize, Serialize};

use crate::id::Handle;

/// Whoever is looking at a room or acting in it. Every view, every rendered message and every
/// incoming command is for or from an observer. Each has its own names for things.
/// (NPC minds will join as a third kind.)
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Observer {
    /// Sees the truth and may command anything.
    Dm,
    /// A player's seat: commands only its own creatures.
    Seat(Handle),
}
