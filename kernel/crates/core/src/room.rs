use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use crate::codex::Codex;
use crate::command::{Command, Rejection};
use crate::creature::Creature;
use crate::def::RoomDef;
use crate::event::{Event, Recorded};
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Map;
use crate::movement;
use crate::names::Names;
use crate::observer::Observer;
use crate::stance::{self, Stance};

/// Everything true about a room right now. Only ever changed by [`RoomState::apply`].
#[derive(Clone, Debug, PartialEq)]
pub struct RoomState {
    pub name: String,
    pub codex: Arc<Codex>,
    pub map: Map,
    pub creatures: BTreeMap<EntityId, Creature>,
    /// Each seat and the creatures it controls.
    pub seats: BTreeMap<Handle, BTreeSet<EntityId>>,
    /// Every observer's names for things.
    pub names: BTreeMap<Observer, Names>,
    /// The next id to give out. Ids are never reused, so an old event can't point at a new creature.
    pub next_id: u32,
}

impl RoomState {
    /// The DM knows everything by the author's key and true name. A seat sees through its lead
    /// creature: its own creatures and the lead's acquaintances by name, everyone else by the most
    /// salient identity the lead reads in passing ("goblin", then "goblin-2"), or "someone".
    fn genesis(def: &RoomDef, codex: Arc<Codex>) -> Result<Self, String> {
        let built = def.build(&codex)?;
        let mut names = BTreeMap::new();
        let dm: &mut Names = names.entry(Observer::Dm).or_default();
        for (id, key) in &built.keys {
            dm.learn(*id, key.clone(), built.creatures[id].name.clone());
        }
        for (seat, own) in &built.seats {
            let n: &mut Names = names.entry(Observer::Seat(seat.clone())).or_default();
            let lead = own.first().map(|id| &built.creatures[id]);
            for (id, key) in &built.keys {
                let c = &built.creatures[id];
                if own.contains(id) || lead.is_some_and(|l| l.acquainted.contains(id)) {
                    n.learn(*id, key.clone(), c.name.clone());
                    continue;
                }
                let label = lead
                    .and_then(|l| {
                        let facets = stance::passing_facets(&codex, l, c);
                        // The most salient identity; the first listed wins a tie.
                        let best = facets.iter().filter(|f| f.identity.is_some()).rev().max_by_key(|f| f.salience)?;
                        codex.identities.get(best.identity.as_ref()?).map(|d| d.label.clone())
                    })
                    .unwrap_or_else(|| "someone".into());
                n.learn(*id, Handle::slug(&label), label);
            }
        }
        Ok(Self {
            name: def.name.clone(),
            codex,
            map: built.map,
            next_id: built.keys.len() as u32 + 1,
            creatures: built.creatures,
            seats: built.seats,
            names,
        })
    }

    pub fn observers(&self) -> impl Iterator<Item = Observer> + '_ {
        std::iter::once(Observer::Dm).chain(self.seats.keys().cloned().map(Observer::Seat))
    }

    pub fn creature_at(&self, c: Cell) -> Option<&Creature> {
        self.creatures.values().find(|cr| cr.pos == c)
    }

    /// How `observer` stands toward `target`, from its own reading of them.
    pub fn stance(&self, observer: EntityId, target: EntityId) -> Stance {
        stance::stance(&self.codex, &self.creatures[&observer], &self.creatures[&target])
    }

    /// The first creature a seat controls: whose eyes the seat sees through, for now.
    pub fn lead(&self, seat: &Handle) -> Option<EntityId> {
        self.seats.get(seat)?.first().copied()
    }

    /// Whether `obs` may command `who`.
    pub fn controls(&self, obs: &Observer, who: EntityId) -> bool {
        match obs {
            Observer::Dm => true,
            Observer::Seat(s) => self.seats.get(s).is_some_and(|ids| ids.contains(&who)),
        }
    }

    /// How `obs` would refer to `id` in a sentence.
    pub fn label(&self, obs: &Observer, id: EntityId) -> String {
        self.names.get(obs).and_then(|n| n.of(id)).map_or_else(|| "something".into(), |a| a.label.clone())
    }

    /// A rejection in `obs`'s own words.
    pub fn explain(&self, obs: &Observer, r: &Rejection) -> String {
        let name = |id| self.label(obs, id);
        let text = match r {
            Rejection::UnknownName { name } => format!("you don't know anything called \"{name}\""),
            Rejection::NotYours { who } => format!("{} isn't yours to command", name(*who)),
            Rejection::DmOnly => "only the DM can do that".into(),
            Rejection::OffMap { at } => format!("{at} is off the map"),
            Rejection::AlreadyThere { who, at } => format!("{} is already at {at}", name(*who)),
            Rejection::Blocked { at, terrain } => format!("{at} is {terrain}"),
            Rejection::Occupied { at, by } => format!("{} is already at {at}", name(*by)),
            Rejection::NoRoute { who, to } => format!("{} has no way to reach {to}", name(*who)),
            Rejection::TooFar { who, to, cost_ft, speed_ft } => {
                format!("{to} is {cost_ft} ft away by the shortest route; {} has {speed_ft} ft of speed", name(*who))
            }
        };
        let mut chars = text.chars();
        chars.next().map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
    }

    /// Turns a command as `obs` sent it, in their names, into one the rules understand, and checks
    /// that they're allowed to send it.
    pub fn resolve(&self, obs: &Observer, cmd: &Command<String>) -> Result<Command, Rejection> {
        let find = |name: &String| {
            self.names
                .get(obs)
                .and_then(|n| n.resolve(name))
                .ok_or_else(|| Rejection::UnknownName { name: name.clone() })
        };
        match cmd {
            Command::Move { who, to } => {
                let who = find(who)?;
                if !self.controls(obs, who) {
                    return Err(Rejection::NotYours { who });
                }
                Ok(Command::Move { who, to: *to })
            }
            Command::Place { who, to } => {
                if *obs != Observer::Dm {
                    return Err(Rejection::DmOnly);
                }
                Ok(Command::Place { who: find(who)?, to: *to })
            }
        }
    }

    /// Checks a resolved command against this state and says what would happen. Changes nothing.
    pub fn decide(&self, cmd: &Command) -> Result<Vec<Event>, Rejection> {
        match *cmd {
            Command::Move { who: id, to } => {
                let who = &self.creatures[&id];
                if !self.map.in_bounds(to) {
                    return Err(Rejection::OffMap { at: to });
                }
                if to == who.pos {
                    return Err(Rejection::AlreadyThere { who: id, at: to });
                }
                if let Some(t) = self.map.terrain(to).filter(|t| t.blocks_move) {
                    return Err(Rejection::Blocked { at: to, terrain: t.name.clone() });
                }
                if let Some(other) = self.creature_at(to) {
                    return Err(Rejection::Occupied { at: to, by: other.id });
                }
                let route = movement::route(self, who, to).ok_or(Rejection::NoRoute { who: id, to })?;
                if route.cost_ft > who.speed_ft {
                    return Err(Rejection::TooFar { who: id, to, cost_ft: route.cost_ft, speed_ft: who.speed_ft });
                }
                Ok(vec![Event::CreatureMoved { who: id, path: route.path, cost_ft: route.cost_ft }])
            }
            Command::Place { who, to } => {
                if !self.map.in_bounds(to) {
                    return Err(Rejection::OffMap { at: to });
                }
                if let Some(t) = self.map.terrain(to).filter(|t| t.blocks_move) {
                    return Err(Rejection::Blocked { at: to, terrain: t.name.clone() });
                }
                if let Some(other) = self.creature_at(to).filter(|c| c.id != who) {
                    return Err(Rejection::Occupied { at: to, by: other.id });
                }
                Ok(vec![Event::CreaturePlaced { who, to }])
            }
        }
    }

    /// Folds one event in. Never fails: `decide` already checked it.
    fn apply(&mut self, event: &Event) {
        match event {
            Event::RoomOpened { .. } => unreachable!("RoomOpened only starts a log"),
            Event::CreatureMoved { who, path, .. } => {
                if let (Some(c), Some(&end)) = (self.creatures.get_mut(who), path.last()) {
                    c.pos = end;
                }
            }
            Event::CreaturePlaced { who, to } => {
                if let Some(c) = self.creatures.get_mut(who) {
                    c.pos = *to;
                }
            }
        }
    }
}

/// A command in a batch that was refused, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub index: usize,
    pub rejection: Rejection,
}

/// A room: its event log and the state folded from it.
#[derive(Clone, Debug)]
pub struct Room {
    pub id: String,
    log: Vec<Recorded>,
    state: RoomState,
}

impl Room {
    pub fn open(id: impl Into<String>, def: RoomDef, codex: Codex) -> Result<Self, String> {
        codex.check()?;
        let codex = Arc::new(codex);
        let state = RoomState::genesis(&def, codex.clone())?;
        let log = vec![Recorded { seq: 1, event: Event::RoomOpened { def: Arc::new(def), codex } }];
        Ok(Self { id: id.into(), log, state })
    }

    pub fn state(&self) -> &RoomState {
        &self.state
    }

    /// The seq of the last event.
    pub fn seq(&self) -> u64 {
        self.log.last().map_or(0, |r| r.seq)
    }

    /// Events with seq greater than `seq`.
    pub fn events_since(&self, seq: u64) -> &[Recorded] {
        let start = self.log.partition_point(|r| r.seq <= seq);
        &self.log[start..]
    }

    /// Runs a batch of commands from `obs` atomically: each sees the effects of the ones before
    /// it, and if any is refused, nothing is committed. With `dry_run`, nothing is committed either way.
    pub fn execute(&mut self, obs: &Observer, cmds: &[Command<String>], dry_run: bool) -> Result<Vec<Recorded>, Refused> {
        let mut scratch = self.state.clone();
        let mut seq = self.seq();
        let mut out = Vec::new();
        for (index, cmd) in cmds.iter().enumerate() {
            let events = scratch
                .resolve(obs, cmd)
                .and_then(|c| scratch.decide(&c))
                .map_err(|rejection| Refused { index, rejection })?;
            for event in events {
                scratch.apply(&event);
                seq += 1;
                out.push(Recorded { seq, event });
            }
        }
        if !dry_run {
            self.state = scratch;
            self.log.extend(out.iter().cloned());
        }
        Ok(out)
    }

    /// Drops every event after `seq` and rebuilds the state from what's left.
    pub fn rewind_to(&mut self, seq: u64) -> Result<(), String> {
        if seq == 0 {
            return Err("can't rewind past the room's opening".into());
        }
        self.log.truncate(self.log.partition_point(|r| r.seq <= seq));
        self.state = Self::fold(&self.log)?;
        Ok(())
    }

    fn fold(log: &[Recorded]) -> Result<RoomState, String> {
        let (first, rest) = log.split_first().ok_or("empty log")?;
        let Event::RoomOpened { def, codex } = &first.event else {
            return Err("the log doesn't start with the room opening".into());
        };
        let mut state = RoomState::genesis(def, codex.clone())?;
        for r in rest {
            state.apply(&r.event);
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::def::CreatureDef;
    use crate::stance::Stance;
    use crate::map::Terrain;

    fn terrain(name: &str, blocks: bool, difficult: bool) -> Terrain {
        Terrain { name: name.into(), blocks_move: blocks, blocks_sight: blocks, difficult }
    }

    fn h(s: &str) -> Handle {
        Handle::new(s).unwrap()
    }

    fn codex() -> Codex {
        serde_json::from_value(serde_json::json!({
            "identities": {
                "human": { "label": "human", "kind": "kind" },
                "goblin": { "label": "goblin", "kind": "kind" },
                "red-watch": { "label": "Red Watch", "kind": "group" },
                "stranger": { "label": "stranger", "kind": "relational" }
            },
            "marks": {
                "human-features": { "senses": { "sight": 2 }, "layers": [ { "reveals": { "text": "a human", "identity": "human" } } ] },
                "goblin-features": { "senses": { "sight": 3 }, "layers": [ { "reveals": { "text": "a goblin", "identity": "goblin", "salience": "high" } } ] },
                "red-tabard": { "senses": { "sight": 3 }, "layers": [ { "reveals": { "text": "a red tabard" }, "children": [
                    { "gate": { "knows": "red-watch-insignia" }, "reveals": { "text": "the Red Watch's colours", "identity": "red-watch", "salience": "high" } }
                ] } ] }
            }
        }))
        .unwrap()
    }

    fn creature(key: &str, name: &str, x: i32, y: i32, extra: serde_json::Value) -> CreatureDef {
        let mut v = serde_json::json!({ "key": key, "name": name, "at": { "x": x, "y": y }, "hp": 10 });
        v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(v).unwrap()
    }

    /// Rook wears the Red Watch's colours. Snikka knows them and hates the Watch; Grub doesn't know
    /// them and is merely wary of humans, so Grub's square doesn't block Rook but Snikka's would.
    fn room_with(snikka_at: (i32, i32), grub_at: (i32, i32)) -> Room {
        use serde_json::json;
        let def = RoomDef {
            name: "test".into(),
            legend: BTreeMap::from([
                ('.', terrain("floor", false, false)),
                ('#', terrain("wall", true, false)),
                (',', terrain("rubble", false, true)),
            ]),
            rows: vec![
                "#########".into(),
                "#.......#".into(),
                "#.#####.#".into(),
                "#.,,,,,.#".into(),
                "#########".into(),
            ],
            creatures: vec![
                creature("rook", "Rook", 1, 1, json!({
                    "marks": [ { "kind": "human-features" }, { "kind": "red-tabard" } ],
                    "identities": ["red-watch"], "knows": ["red-watch-insignia"], "dispositions": { "goblin": "hostile" }
                })),
                creature("snikka", "Snikka", snikka_at.0, snikka_at.1, json!({
                    "marks": [ { "kind": "goblin-features" } ], "knows": ["red-watch-insignia"], "dispositions": { "red-watch": "hostile" }
                })),
                creature("grub", "Grub", grub_at.0, grub_at.1, json!({
                    "marks": [ { "kind": "goblin-features" } ], "dispositions": { "human": "wary" }
                })),
            ],
            seats: BTreeMap::from([(h("alice"), vec![h("rook")])]),
        };
        Room::open("t", def, codex()).unwrap()
    }

    fn room() -> Room {
        room_with((7, 3), (4, 1))
    }

    const DM: Observer = Observer::Dm;

    fn alice() -> Observer {
        Observer::Seat(h("alice"))
    }

    fn mv(who: &str, x: i32, y: i32) -> Command<String> {
        Command::Move { who: who.into(), to: Cell::new(x, y) }
    }

    fn place(who: &str, x: i32, y: i32) -> Command<String> {
        Command::Place { who: who.into(), to: Cell::new(x, y) }
    }

    fn cost(ev: &[Recorded]) -> u32 {
        match &ev[0].event {
            Event::CreatureMoved { cost_ft, .. } => *cost_ft,
            e => panic!("{e:?}"),
        }
    }

    fn rook_pos(r: &Room) -> Cell {
        r.state().creatures[&EntityId(1)].pos
    }

    #[test]
    fn moves_along_open_floor() {
        let mut r = room();
        let ev = r.execute(&DM, &[mv("rook", 5, 1)], false).unwrap();
        assert_eq!(ev[0].seq, 2);
        assert_eq!(rook_pos(&r), Cell::new(5, 1));
    }

    #[test]
    fn routes_run_straight() {
        let mut r = room();
        let ev = r.execute(&DM, &[mv("rook", 5, 1)], false).unwrap();
        let Event::CreatureMoved { path, cost_ft, .. } = &ev[0].event else { panic!() };
        assert_eq!(*cost_ft, 20);
        assert!(path.iter().all(|c| c.y == 1), "{path:?}");
    }

    #[test]
    fn routes_around_walls_and_refuses_beyond_speed() {
        let mut r = room();
        r.execute(&DM, &[mv("rook", 1, 3)], false).unwrap();
        // Through the rubble is 45 ft; back round the top of the wall is 40. Both are past 30 ft of speed.
        let err = r.execute(&DM, &[mv("rook", 6, 3)], false).unwrap_err();
        assert_eq!(err.index, 0);
        assert_eq!(err.rejection.code(), "too_far");
    }

    #[test]
    fn difficult_terrain_costs_double_to_leave_not_to_enter() {
        let mut r = room();
        r.execute(&DM, &[place("rook", 1, 3)], false).unwrap();
        assert_eq!(cost(&r.execute(&DM, &[mv("rook", 2, 3)], false).unwrap()), 5, "stepping into rubble");
        assert_eq!(cost(&r.execute(&DM, &[mv("rook", 3, 3)], false).unwrap()), 10, "rubble to rubble");
        r.execute(&DM, &[place("rook", 6, 3)], false).unwrap();
        assert_eq!(cost(&r.execute(&DM, &[mv("rook", 7, 2)], false).unwrap()), 10, "stepping out of rubble");
    }

    #[test]
    fn hostile_squares_block_and_batches_are_atomic() {
        let mut r = room();
        let before = r.state().clone();
        let err = r.execute(&DM, &[mv("rook", 6, 1), mv("rook", 7, 3)], false).unwrap_err();
        assert_eq!(err.index, 1, "the second move ends on Snikka");
        assert_eq!(r.state(), &before);
        assert_eq!(r.seq(), 1);
    }

    #[test]
    fn dry_run_and_rewind_leave_no_trace() {
        let mut r = room();
        r.execute(&DM, &[mv("rook", 6, 1)], true).unwrap();
        assert_eq!(r.seq(), 1);
        let start = r.state().clone();
        r.execute(&DM, &[mv("rook", 6, 1), mv("rook", 7, 2)], false).unwrap();
        assert_eq!(r.seq(), 3);
        r.rewind_to(1).unwrap();
        assert_eq!(r.state(), &start);
        assert!(r.events_since(1).is_empty());
    }

    #[test]
    fn each_observer_has_its_own_names() {
        let r = room();
        let s = r.state();
        let dm = &s.names[&DM];
        let seat = &s.names[&alice()];
        assert_eq!(dm.resolve("snikka"), Some(EntityId(2)));
        assert_eq!(seat.resolve("snikka"), None, "Alice has never heard the name");
        assert_eq!(seat.resolve("goblin"), Some(EntityId(2)));
        assert_eq!(seat.resolve("goblin-2"), Some(EntityId(3)));
        assert_eq!(seat.resolve("rook"), Some(EntityId(1)));
    }

    #[test]
    fn seats_command_only_their_own_and_hear_rejections_in_their_own_words() {
        let mut r = room();
        let err = r.execute(&alice(), &[mv("goblin", 6, 1)], false).unwrap_err();
        assert_eq!(err.rejection, Rejection::NotYours { who: EntityId(2) });
        assert_eq!(r.state().explain(&alice(), &err.rejection), "Goblin isn't yours to command");
        assert_eq!(r.execute(&alice(), &[mv("snikka", 6, 1)], false).unwrap_err().rejection.code(), "unknown_name");
        assert_eq!(r.execute(&alice(), &[place("rook", 6, 1)], false).unwrap_err().rejection, Rejection::DmOnly);

        let err = r.execute(&alice(), &[mv("rook", 4, 1)], false).unwrap_err();
        assert_eq!(r.state().explain(&alice(), &err.rejection), "Goblin is already at (4, 1)");
        assert_eq!(r.state().explain(&DM, &err.rejection), "Grub is already at (4, 1)");
    }

    #[test]
    fn only_creatures_hostile_to_you_by_their_own_reading_block_your_way() {
        let rook = EntityId(1);
        let mut r = room();
        assert_eq!(r.state().stance(EntityId(3), rook), Stance::Wary, "Grub sees only a human");
        assert_eq!(cost(&r.execute(&DM, &[mv("rook", 6, 1)], false).unwrap()), 25, "straight through Grub's square");

        let mut r = room_with((4, 1), (7, 3));
        assert_eq!(r.state().stance(EntityId(2), rook), Stance::Hostile, "Snikka reads the Watch's colours");
        assert_eq!(r.execute(&DM, &[mv("rook", 6, 1)], false).unwrap_err().rejection.code(), "too_far", "the long way round");
    }

    #[test]
    fn seats_name_strangers_by_what_their_lead_reads() {
        let r = room();
        let names = &r.state().names[&alice()];
        assert_eq!(names.of(EntityId(2)).unwrap().label, "goblin");
        assert_eq!(names.of(EntityId(3)).unwrap().handle.as_str(), "goblin-2");
    }
}
