//! What an observer is shown: the room and its events, in that observer's names. Nothing here
//! carries an [`EntityId`]; anything the observer has no name for is left out.
//! (No fog yet: every observer sees every square, but only what they know of each creature.)

use serde::Serialize;

use crate::codex::Salience;
use crate::event::{Event, Recorded};
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Map;
use crate::names::Acquaintance;
use crate::observer::Observer;
use crate::room::{Room, RoomState};
use crate::stance::{self, Stance};

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
    pub pos: Cell,
    /// Whether this observer may command it.
    pub yours: bool,
    /// For a seat: how its lead creature stands toward this one. For the DM: how this one stands
    /// toward the seats' creatures (the most negative). None for a seat's own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stance: Option<Stance>,
    /// For a seat: what its lead notices in passing, low-salience things left out. For the DM: its marks.
    pub appears: Vec<String>,
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
        let lead = match obs {
            Observer::Dm => None,
            Observer::Seat(seat) => s.lead(seat),
        };
        let seated: Vec<_> = s.seats.values().flatten().copied().collect();
        let creatures = s
            .creatures
            .values()
            .filter_map(|c| {
                let a = known(s, obs, c.id)?;
                let yours = s.controls(obs, c.id);
                // Stats are for the DM, and for a seat about its own creatures and the people its lead knows.
                let open = *obs == Observer::Dm || yours || lead.is_some_and(|l| s.creatures[&l].acquainted.contains(&c.id));
                let stance = match (obs, lead) {
                    (Observer::Dm, _) => seated.iter().filter(|&&p| p != c.id).map(|&p| s.stance(c.id, p)).min(),
                    (_, Some(l)) if !yours => Some(s.stance(l, c.id)),
                    _ => None,
                };
                let appears = match lead {
                    Some(l) => stance::passing_facets(&s.codex, &s.creatures[&l], c)
                        .into_iter()
                        .filter(|f| f.salience > Salience::Low)
                        .map(|f| f.text)
                        .collect(),
                    None if *obs == Observer::Dm => c.marks.iter().map(|m| m.kind.to_string()).collect(),
                    None => Vec::new(),
                };
                Some(CreatureView {
                    handle: &a.handle,
                    label: &a.label,
                    pos: c.pos,
                    yours,
                    stance,
                    appears,
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
