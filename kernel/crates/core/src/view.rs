//! What an observer is shown: the room and its events, in that observer's names. Nothing here
//! carries an [`EntityId`]; anything the observer has no name for is left out.
//! (No fog yet: every observer sees every square, but only what they know of each creature.)

use serde::Serialize;

use crate::codex::Salience;
use crate::event::Event;
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Map;
use crate::names::Acquaintance;
use crate::observer::Observer;
use crate::room::{Room, RoomState};
use crate::stance::{self, Stance};
use crate::surgery::{Change, ChangeKind};
use crate::timeline::{GameTime, Outcome, Step, StepId};

#[derive(Clone, Debug, Serialize)]
pub struct RoomView<'a> {
    pub id: &'a str,
    /// The last event this view includes. Clients use it to tell whether they're behind.
    pub seq: u64,
    pub clock: GameTime,
    pub name: &'a str,
    pub observer: &'a Observer,
    pub map: &'a Map,
    pub creatures: Vec<CreatureView<'a>>,
    /// The room's places in definition order (parents before the places inside them, as authored).
    /// Names are the DM's for now; they'll be per observer with perception.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub places: Vec<PlaceView<'a>>,
}

/// A place as an observer reads it: the key the DM types, the name for a sentence, and what it is in.
#[derive(Clone, Debug, Serialize)]
pub struct PlaceView<'a> {
    pub key: &'a Handle,
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<&'a Handle>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreatureView<'a> {
    pub handle: &'a Handle,
    pub label: &'a str,
    pub pos: Cell,
    /// Where it is, in words: "in the nave, 10 ft from the altar". Absent when no place owns the square.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
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
                    place: s.places.position_text(c.pos),
                    yours,
                    stance,
                    appears,
                    speed_ft: open.then_some(c.speed_ft),
                    hp: open.then_some(c.hp),
                    max_hp: open.then_some(c.max_hp),
                })
            })
            .collect();
        let places = s.places.iter().map(|p| PlaceView { key: &p.key, name: &p.name, parent: p.parent.map(|id| &s.places.get(id).key) }).collect();
        Self { id: &room.id, seq: room.seq(), clock: s.clock, name: &s.name, observer: obs, map: &s.map, creatures, places }
    }
}

fn known<'s>(s: &'s RoomState, obs: &Observer, id: EntityId) -> Option<&'s Acquaintance> {
    s.names.get(obs)?.of(id)
}

pub(crate) fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
}

fn by_name(o: &Observer) -> String {
    match o {
        Observer::Dm => "dm".into(),
        Observer::Seat(h) => h.to_string(),
    }
}

/// A step as an observer receives it, or nothing if they'd notice none of it.
#[derive(Clone, Debug, Serialize)]
pub struct StepView<'a> {
    pub step: StepId,
    pub time: GameTime,
    /// `dm` or the seat's name.
    pub by: String,
    /// The author's summary, for the DM and the author only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gist: Option<&'a str>,
    pub events: Vec<EventView<'a>>,
    /// Why the step no longer applies, for the DM and the author only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropped: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventView<'a> {
    CreatureMoved { who: &'a Handle, path: &'a [Cell], cost_ft: u32 },
    CreaturePlaced { who: &'a Handle, to: Cell },
    TimePassed { seconds: u64 },
}

fn event_view<'a>(s: &'a RoomState, obs: &Observer, e: &'a Event) -> Option<EventView<'a>> {
    Some(match e {
        Event::CreatureMoved { who, path, cost_ft } => EventView::CreatureMoved { who: &known(s, obs, *who)?.handle, path, cost_ft: *cost_ft },
        Event::CreaturePlaced { who, to } => EventView::CreaturePlaced { who: &known(s, obs, *who)?.handle, to: *to },
        Event::TimePassed { seconds } => EventView::TimePassed { seconds: *seconds },
    })
}

impl<'a> StepView<'a> {
    pub fn new(s: &'a RoomState, obs: &Observer, step: &'a Step) -> Option<Self> {
        let insider = *obs == Observer::Dm || step.by == *obs;
        let events: Vec<_> = step.events().iter().filter_map(|e| event_view(s, obs, e)).collect();
        if events.is_empty() && !insider {
            return None;
        }
        let dropped = match &step.outcome {
            Outcome::Dropped { rejection, .. } if insider => Some(s.explain(obs, rejection)),
            _ => None,
        };
        Some(Self { step: step.id, time: step.time, by: by_name(&step.by), gist: step.gist.as_deref().filter(|_| insider), events, dropped })
    }
}

fn duration(seconds: u64) -> String {
    let (n, unit) = match seconds {
        s if s >= 3600 && s % 3600 == 0 => (s / 3600, "hour"),
        s if s >= 60 && s % 60 == 0 => (s / 60, "minute"),
        s if s >= 6 && s % 6 == 0 => (s / 6, "round"),
        s => (s, "second"),
    };
    format!("{n} {unit}{}", if n == 1 { "" } else { "s" })
}

/// ", in the nave" or ", at the altar" for the most specific place that owns the square; nothing if
/// none does.
fn at_place(s: &RoomState, c: Cell) -> String {
    s.places.at(c).map_or_else(String::new, |id| format!(", {} {}", s.places.preposition(id), s.places.get(id).name))
}

/// An event in `obs`'s words, or nothing if they have no name for who it's about.
pub fn event_text(s: &RoomState, obs: &Observer, e: &Event) -> Option<String> {
    Some(match e {
        Event::CreatureMoved { who, path, cost_ft } => {
            known(s, obs, *who)?;
            let to = *path.last()?;
            format!("{} moves {cost_ft} ft to {to}{}", capitalize(&s.label(obs, *who)), at_place(s, to))
        }
        Event::CreaturePlaced { who, to } => {
            known(s, obs, *who)?;
            format!("{} is placed at {to}{}", capitalize(&s.label(obs, *who)), at_place(s, *to))
        }
        Event::TimePassed { seconds } => format!("time passes: {}", duration(*seconds)),
    })
}

fn events_text(s: &RoomState, obs: &Observer, events: &[Event]) -> String {
    events.iter().filter_map(|e| event_text(s, obs, e)).collect::<Vec<_>>().join("; ")
}

/// A step's line without its id: `R3 alice: "gist" — Rook moves 15 ft to (4, 5)`.
fn step_body(s: &RoomState, obs: &Observer, step: &Step) -> Option<String> {
    let v = StepView::new(s, obs, step)?;
    let mut line = format!("{} {}", v.time, v.by);
    if let Some(g) = v.gist {
        line += &format!(": \"{g}\"");
    }
    let what = events_text(s, obs, step.events());
    if !what.is_empty() {
        line += &format!(" — {what}");
    }
    if let Some(d) = v.dropped {
        line += &format!(" ⚠ dropped: {d}");
    }
    Some(line)
}

/// One line per step, always the same shape, in `obs`'s names:
/// `#12 R3 alice: "gist" — Rook moves 15 ft to (4, 5)`. Every id can be passed back as an argument.
pub fn step_line(s: &RoomState, obs: &Observer, step: &Step) -> Option<String> {
    Some(format!("{} {}", step.id, step_body(s, obs, step)?))
}

/// Seats that would have noticed something in this step.
pub fn seen_by(s: &RoomState, step: &Step) -> Vec<String> {
    s.seats
        .keys()
        .filter(|seat| {
            let o = Observer::Seat((*seat).clone());
            step.events().iter().any(|e| event_view(s, &o, e).is_some())
        })
        .map(|h| h.to_string())
        .collect()
}

/// "3 changes: 1 inserted, 1 dropped, 1 rerouted", or "no changes".
pub fn summary(changes: &[Change]) -> String {
    if changes.is_empty() {
        return "no changes".into();
    }
    let mut counts: Vec<(ChangeKind, usize)> = Vec::new();
    for c in changes {
        match counts.iter_mut().find(|(k, _)| *k == c.kind) {
            Some((_, n)) => *n += 1,
            None => counts.push((c.kind, 1)),
        }
    }
    let parts: Vec<String> = counts.iter().map(|(k, n)| format!("{n} {}", kind_word(*k))).collect();
    format!("{} change{}: {}", changes.len(), if changes.len() == 1 { "" } else { "s" }, parts.join(", "))
}

fn kind_word(k: ChangeKind) -> &'static str {
    match k {
        ChangeKind::Inserted => "inserted",
        ChangeKind::Removed => "removed",
        ChangeKind::Edited => "edited",
        ChangeKind::KeptAsFiat => "kept as fiat",
        ChangeKind::Rerouted => "rerouted",
        ChangeKind::Differs => "differs",
        ChangeKind::Dropped => "dropped",
        ChangeKind::Recovered => "recovered",
    }
}

/// A change as the DM reads it: what the step does now, what it did before, and who saw the old version.
/// `⚠` marks the ones that need a decision.
pub fn change_line(room: &Room, c: &Change) -> String {
    let (s, t, dm) = (room.state(), room.timeline(), &Observer::Dm);
    let old = c.old.and_then(|id| t.step(id));
    let new = c.new.and_then(|id| t.step(id));
    let warn = matches!(c.kind, ChangeKind::Dropped | ChangeKind::Differs);
    let ids = match (c.old, c.new) {
        (Some(o), Some(n)) => format!("{o} → {n}"),
        (Some(o), None) => o.to_string(),
        (None, Some(n)) => n.to_string(),
        (None, None) => String::new(),
    };
    let mut line = format!("{} {} {ids}: ", if warn { "⚠" } else { "·" }, kind_word(c.kind));
    line += &new.or(old).and_then(|st| step_body(s, dm, st)).unwrap_or_default();
    if let (Some(o), true) = (old, new.is_some() && !matches!(c.kind, ChangeKind::Edited | ChangeKind::KeptAsFiat)) {
        let before = events_text(s, dm, o.events());
        if !before.is_empty() {
            line += &format!("; was: {before}");
        }
    }
    if let Some(o) = old.filter(|_| c.kind != ChangeKind::Recovered) {
        let seen = seen_by(s, o);
        if !seen.is_empty() {
            line += &format!(" · seen by {}", seen.join(", "));
        }
    }
    line
}

/// A draft's summary line followed by one line per change.
pub fn preview_lines(room: &Room, changes: &[Change]) -> Vec<String> {
    std::iter::once(summary(changes)).chain(changes.iter().map(|c| change_line(room, c))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;

    #[test]
    fn step_lines_name_the_place_when_one_owns_the_square() {
        let mut r = room();
        // (5,1) is in the corridor; (1,2) is a floor square no place owns.
        let st = run(&mut r, &[mv("rook", 5, 1), place("grub", 1, 2)]);
        let line = step_line(r.state(), &DM, &st).unwrap();
        assert!(line.ends_with("Rook moves 20 ft to (5, 1), in the corridor; Grub is placed at (1, 2)"), "{line}");
        let st = run(&mut r, &[place("snikka", 3, 3)]);
        assert!(step_line(r.state(), &DM, &st).unwrap().ends_with("Snikka is placed at (3, 3), in the rubble"));
    }

    #[test]
    fn the_view_carries_places_and_where_each_creature_is() {
        let r = room();
        let v = RoomView::new(&r, &DM);
        let keys: Vec<_> = v.places.iter().map(|p| p.key.to_string()).collect();
        assert_eq!(keys, ["corridor", "rubble-strip"]);
        let rook = v.creatures.iter().find(|c| c.handle.as_str() == "rook").unwrap();
        assert_eq!(rook.place.as_deref(), Some("in the corridor, 10 ft from the rubble"));
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["places"][0]["key"], "corridor");
        assert_eq!(json["creatures"][0]["place"], "in the corridor, 10 ft from the rubble");
    }
}
