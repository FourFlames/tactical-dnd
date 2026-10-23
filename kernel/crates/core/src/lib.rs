//! The rules kernel. Pure: no files, no network, no clock.
//!
//! A [`Room`] is event-sourced. Callers send [`Command`]s; the room checks them against its
//! current [`RoomState`], turns them into [`Event`]s, and folds those into the state. The event
//! log is the truth: the state can always be rebuilt from it, which is what makes rewind cheap.

pub mod command;
pub mod creature;
pub mod def;
pub mod event;
pub mod geom;
pub mod map;
pub mod movement;
pub mod room;
pub mod view;

pub use command::{Command, Rejection};
pub use creature::{Creature, CreatureId, Side};
pub use def::{CreatureDef, RoomDef};
pub use event::{Event, Recorded};
pub use geom::Cell;
pub use map::{Map, Terrain};
pub use room::{Room, RoomState};
pub use view::RoomView;
