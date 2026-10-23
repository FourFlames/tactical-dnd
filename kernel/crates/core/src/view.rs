//! What an observer is shown: the room and its events, in that observer's names. Nothing here
//! carries an [`EntityId`]; anything the observer has no name for is left out.
//! (No fog yet: every observer sees every square, but only what they know of each creature.)

use serde::Serialize;

use crate::creature::Side;
use crate::event::{Event, Recorded};
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Map;
use crate::names::Acquaintance;
use crate::observer::Observer;
use crate::room::{Room, RoomState};

#[derive(Clone, Debug, Serialize)]
pub struct RoomView<'a> {
    pub id: &'a str,
    /// The last event this view includes. Clients use it to tell whether they're behind.
    pub seq: u64,
    pub name: &'a str,
    pub observer: &'a Observer,
    pub map: &'a Map,
    pub creatures: Vec<CreatureView<'a>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreatureView<'a> {
    pub handle: &'a Handle,
    pub label: &'a str,
    pub side: Side,
    pub pos: Cell,
    /// Whether this observer may command it.
    pub yours: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_ft: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hp: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_hp: Option<i32>,
}

impl<'a> RoomView<'a> {
    pub fn new(room: &'a Room, obs: &'a Observer) -> Self {
        let s = room.state();
        let creatures = s
            .creatures
            .values()
            .filter_map(|c| {
                let a = known(s, obs, c.id)?;
                // Stats are for the DM, and for the party about itself.
                let open = *obs == Observer::Dm || c.side == Side::Party;
                Some(CreatureView {
                    handle: &a.handle,
                    label: &a.label,
                    side: c.side,
                    pos: c.pos,
                    yours: s.controls(obs, c.id),
                    speed_ft: open.then_some(c.speed_ft),
                    hp: open.then_some(c.hp),
                    max_hp: open.then_some(c.max_hp),
                })
            })
            .collect();
        Self { id: &room.id, seq: room.seq(), name: &s.name, observer: obs, map: &s.map, creatures }
    }
}

fn known<'s>(s: &'s RoomState, obs: &Observer, id: EntityId) -> Option<&'s Acquaintance> {
    s.names.get(obs)?.of(id)
}

/// An event as an observer receives it.
#[derive(Clone, Debug, Serialize)]
pub struct RecordedView<'a> {
    pub seq: u64,
    #[serde(flatten)]
    pub event: EventView<'a>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventView<'a> {
    CreatureMoved { who: &'a Handle, path: &'a [Cell], cost_ft: u32 },
    CreaturePlaced { who: &'a Handle, to: Cell },
}

/// `r` as `obs` would receive it, or `None` if it isn't something they'd be told about.
pub fn event_view<'a>(s: &'a RoomState, obs: &Observer, r: &'a Recorded) -> Option<RecordedView<'a>> {
    let event = match &r.event {
        Event::RoomOpened { .. } => return None,
        Event::CreatureMoved { who, path, cost_ft } => {
            EventView::CreatureMoved { who: &known(s, obs, *who)?.handle, path, cost_ft: *cost_ft }
        }
        Event::CreaturePlaced { who, to } => EventView::CreaturePlaced { who: &known(s, obs, *who)?.handle, to: *to },
    };
    Some(RecordedView { seq: r.seq, event })
}
