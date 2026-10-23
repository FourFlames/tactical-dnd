//! What a client is shown. For now there is one view: everything, as the DM sees it.
//! Player views (fog, hidden creatures) will be further projections of the same state.

use serde::Serialize;

use crate::creature::Creature;
use crate::map::Map;
use crate::room::Room;

#[derive(Clone, Debug, Serialize)]
pub struct RoomView<'a> {
    pub id: &'a str,
    /// The last event this view includes. Clients use it to tell whether they're behind.
    pub seq: u64,
    pub name: &'a str,
    pub map: &'a Map,
    pub creatures: Vec<&'a Creature>,
}

impl<'a> RoomView<'a> {
    pub fn of(room: &'a Room) -> Self {
        let s = room.state();
        Self { id: &room.id, seq: room.seq(), name: &s.name, map: &s.map, creatures: s.creatures.values().collect() }
    }
}
