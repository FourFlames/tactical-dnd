//! The rules kernel. Pure: no files, no network, no clock.
//!
//! A [`Room`] is event-sourced. Observers send [`Command`]s in their own names; the room resolves
//! them to [`EntityId`]s, checks them against its current [`RoomState`], turns them into
//! [`Event`]s, and folds those into the state. The event log is the truth: the state can always be
//! rebuilt from it, which is what makes rewind cheap.
//!
//! Ids never leave the kernel. What goes out (views, events, rejections) is rendered for one
//! [`Observer`] at a time, in that observer's names ([`names`], [`view`]).

pub mod command;
pub mod codex;
pub mod creature;
pub mod dice;
pub mod def;
pub mod event;
pub mod geom;
pub mod id;
pub mod map;
pub mod movement;
pub mod names;
pub mod observer;
pub mod reading;
pub mod room;
pub mod stance;
pub mod surgery;
#[cfg(test)]
mod testkit;
pub mod timeline;
pub mod view;

pub use command::{Command, Rejection};
pub use codex::Codex;
pub use creature::Creature;
pub use def::{CreatureDef, RoomDef};
pub use event::Event;
pub use geom::Cell;
pub use id::{EntityId, Handle};
pub use map::{Map, Terrain};
pub use observer::Observer;
pub use room::{Refused, Room, RoomState};
pub use stance::Stance;
pub use surgery::{Change, ChangeKind, Preview, Surgery};
pub use timeline::{GameTime, Step, StepId};
pub use view::{change_line, preview_lines, step_line, summary, RoomView, StepView};
