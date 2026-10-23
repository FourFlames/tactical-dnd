use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use crate::codex::Codex;
use crate::command::{Command, Rejection};
use crate::creature::Creature;
use crate::def::RoomDef;
use crate::dice::Dice;
use crate::event::Event;
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Map;
use crate::movement;
use crate::names::Names;
use crate::place::Places;
use crate::observer::Observer;
use crate::stance::{self, Stance};
use crate::timeline::{Branch, GameTime, Input, Outcome, Step, StepId, Timeline, MAIN};

/// Everything true about a room right now. Only ever changed by [`RoomState::apply`].
#[derive(Clone, Debug, PartialEq)]
pub struct RoomState {
    pub name: String,
    pub codex: Arc<Codex>,
    pub map: Map,
    /// Named areas of the map (from the room definition for now).
    pub places: Places,
    pub creatures: BTreeMap<EntityId, Creature>,
    /// Each seat and the creatures it controls.
    pub seats: BTreeMap<Handle, BTreeSet<EntityId>>,
    /// Every observer's names for things.
    pub names: BTreeMap<Observer, Names>,
    /// The next id to give out. Ids are never reused, so an old event can't point at a new creature.
    pub next_id: u32,
    /// Game time, advanced only by events.
    pub clock: GameTime,
}

impl RoomState {
    /// The DM knows everything by the author's key and true name. A seat sees through its lead
    /// creature: its own creatures and the lead's acquaintances by name, everyone else by the most
    /// salient identity the lead reads in passing ("goblin", then "goblin-2"), or "someone".
    pub(crate) fn genesis(def: &RoomDef, codex: Arc<Codex>) -> Result<Self, String> {
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
            places: built.places,
            next_id: built.keys.len() as u32 + 1,
            creatures: built.creatures,
            seats: built.seats,
            names,
            clock: GameTime(0),
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
        crate::view::capitalize(&text)
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
            Command::MoveToward { who, toward } => {
                let who = find(who)?;
                if !self.controls(obs, who) {
                    return Err(Rejection::NotYours { who });
                }
                // A creature the sender knows by that name, else a place (the DM's handles, for now).
                let goals: Vec<Cell> = if let Some(other) = self.names.get(obs).and_then(|n| n.resolve(toward)) {
                    let at = self.creatures[&other].pos;
                    at.neighbors().collect()
                } else if let Some(place) = self.places.resolve(toward) {
                    self.places.squares_within(place)
                } else {
                    return Err(Rejection::UnknownName { name: toward.clone() });
                };
                let me = &self.creatures[&who];
                if goals.contains(&me.pos) || self.names.get(obs).and_then(|n| n.resolve(toward)) == Some(who) {
                    return Err(Rejection::AlreadyThere { who, at: me.pos });
                }
                let near = goals.iter().copied().min_by_key(|g| g.distance_ft(me.pos));
                let to = movement::route_to_any(self, me, &goals.iter().copied().collect()).map(|r| *r.path.last().unwrap());
                match to {
                    Some(to) => Ok(Command::Move { who, to }),
                    None => Err(Rejection::NoRoute { who, to: near.unwrap_or(me.pos) }),
                }
            }
            Command::Place { who, to } => {
                if *obs != Observer::Dm {
                    return Err(Rejection::DmOnly);
                }
                Ok(Command::Place { who: find(who)?, to: *to })
            }
            Command::Wait { seconds } => {
                if *obs != Observer::Dm {
                    return Err(Rejection::DmOnly);
                }
                Ok(Command::Wait { seconds: *seconds })
            }
        }
    }

    /// Checks a resolved command against this state and says what would happen. Changes nothing.
    /// Any roll comes from `dice`, which is tied to the step, so replays roll the same.
    pub fn decide(&self, cmd: &Command, _dice: &mut Dice) -> Result<Vec<Event>, Rejection> {
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
            // Turned into a `Move` by `resolve`; seeing one here means it was never resolved.
            Command::MoveToward { who, .. } => Err(Rejection::NoRoute { who, to: self.creatures[&who].pos }),
            Command::Wait { seconds } => Ok(vec![Event::TimePassed { seconds }]),
        }
    }

    /// Folds one event in. Never fails: `decide` already checked it.
    pub(crate) fn apply(&mut self, event: &Event) {
        match event {
            Event::TimePassed { seconds } => self.clock.0 += seconds,
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

/// A room: its timeline, and the state at the head of the main branch.
#[derive(Clone, Debug)]
pub struct Room {
    pub id: String,
    pub(crate) timeline: Timeline,
    pub(crate) state: RoomState,
}

impl Room {
    pub fn open(id: impl Into<String>, def: RoomDef, codex: Codex) -> Result<Self, String> {
        codex.check()?;
        let (timeline, state) = Timeline::open(def, Arc::new(codex))?;
        Ok(Self { id: id.into(), timeline, state })
    }

    pub fn state(&self) -> &RoomState {
        &self.state
    }

    pub fn timeline(&self) -> &Timeline {
        &self.timeline
    }

    /// The main head's id. Clients use it to tell whether they're behind.
    pub fn seq(&self) -> u64 {
        self.timeline.head().0
    }

    /// Steps on the main branch after `seq`, oldest first.
    pub fn steps_since(&self, seq: u64) -> Vec<&Step> {
        let path = self.timeline.path(self.timeline.head());
        path.into_iter().filter(|id| id.0 > seq).filter_map(|id| self.timeline.step(id)).collect()
    }

    /// The last `limit` steps of a branch (main if `None`), oldest first.
    pub fn history(&self, branch: Option<&str>, limit: usize) -> Result<Vec<&Step>, String> {
        let name = branch.unwrap_or(MAIN);
        let head = self.timeline.branch(name).ok_or_else(|| format!("there is no branch called {name}"))?.head;
        let path = self.timeline.path(head);
        Ok(path[path.len().saturating_sub(limit)..].iter().filter_map(|id| self.timeline.step(*id)).collect())
    }

    /// Runs a batch of commands from `obs` as one step on the main branch: each sees the effects of
    /// the ones before it, and if any is refused, nothing is recorded. With `dry_run`, nothing is
    /// recorded either way; the returned step shows what would happen.
    pub fn execute(&mut self, obs: &Observer, cmds: &[Command<String>], gist: Option<String>, dry_run: bool) -> Result<Step, Refused> {
        let key = self.timeline.peek_id();
        let mut scratch = self.state.clone();
        let mut dice = Dice::new(key);
        let (mut resolved, mut events) = (Vec::new(), Vec::new());
        for (index, cmd) in cmds.iter().enumerate() {
            let refused = |rejection| Refused { index, rejection };
            let cmd = scratch.resolve(obs, cmd).map_err(refused)?;
            let out = scratch.decide(&cmd, &mut dice).map_err(refused)?;
            for e in &out {
                scratch.apply(e);
            }
            events.extend(out);
            resolved.push(cmd);
        }
        let head = self.timeline.head();
        let (input, outcome, time) = (Input::Commands(resolved), Outcome::Applied(events), self.state.clock);
        if dry_run {
            let depth = self.timeline.step(head).map_or(0, |s| s.depth + 1);
            return Ok(Step { id: key, parent: Some(head), depth, key, replaces: None, by: obs.clone(), gist, time, input, outcome });
        }
        let id = self.timeline.push(head, obs.clone(), gist, time, input, outcome, None, None, &scratch);
        self.timeline.set_head(MAIN, Branch { head: id, forked_at: None, gist: None });
        self.state = scratch;
        Ok(self.timeline.step(id).unwrap().clone())
    }

    /// Moves the main head back to `step`. The steps after it stay on a branch called
    /// `before-rewind-<old head>`, which is returned, so nothing is lost.
    pub fn rewind_to(&mut self, step: StepId) -> Result<String, String> {
        let head = self.timeline.head();
        if step == head {
            return Err(format!("main is already at {step}"));
        }
        if !self.timeline.on_path(head, step) {
            return Err(format!("{step} isn't on the main branch"));
        }
        let saved = format!("before-rewind-{}", head.0);
        self.timeline.set_head(&saved, Branch { head, forked_at: None, gist: Some(format!("main before rewinding to {step}")) });
        self.timeline.set_head(MAIN, Branch { head: step, forked_at: None, gist: None });
        self.state = self.timeline.state_at(step);
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;

    #[test]
    fn moves_along_open_floor() {
        let mut r = room();
        let st = run(&mut r, &[mv("rook", 5, 1)]);
        assert_eq!(st.id, StepId(2));
        assert_eq!(pos(&r, 1), Cell::new(5, 1));
    }

    #[test]
    fn routes_run_straight() {
        let mut r = room();
        let st = run(&mut r, &[mv("rook", 5, 1)]);
        let Event::CreatureMoved { path, cost_ft, .. } = &st.events()[0] else { panic!() };
        assert_eq!(*cost_ft, 20);
        assert!(path.iter().all(|c| c.y == 1), "{path:?}");
    }

    #[test]
    fn routes_around_walls_and_refuses_beyond_speed() {
        let mut r = room();
        run(&mut r, &[mv("rook", 1, 3)]);
        // Through the rubble is 45 ft; back round the top of the wall is 40. Both are past 30 ft of speed.
        let err = r.execute(&DM, &[mv("rook", 6, 3)], None, false).unwrap_err();
        assert_eq!(err.index, 0);
        assert_eq!(err.rejection.code(), "too_far");
    }

    #[test]
    fn difficult_terrain_costs_double_to_leave_not_to_enter() {
        let mut r = room();
        run(&mut r, &[place("rook", 1, 3)]);
        assert_eq!(cost(&run(&mut r, &[mv("rook", 2, 3)])), 5, "stepping into rubble");
        assert_eq!(cost(&run(&mut r, &[mv("rook", 3, 3)])), 10, "rubble to rubble");
        run(&mut r, &[place("rook", 6, 3)]);
        assert_eq!(cost(&run(&mut r, &[mv("rook", 7, 2)])), 10, "stepping out of rubble");
    }

    #[test]
    fn hostile_squares_block_and_batches_are_atomic() {
        let mut r = room();
        let before = r.state().clone();
        let err = r.execute(&DM, &[mv("rook", 6, 1), mv("rook", 7, 3)], None, false).unwrap_err();
        assert_eq!(err.index, 1, "the second move ends on Snikka");
        assert_eq!(r.state(), &before);
        assert_eq!(r.seq(), 1);
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
        let err = r.execute(&alice(), &[mv("goblin", 6, 1)], None, false).unwrap_err();
        assert_eq!(err.rejection, Rejection::NotYours { who: EntityId(2) });
        assert_eq!(r.state().explain(&alice(), &err.rejection), "Goblin isn't yours to command");
        assert_eq!(r.execute(&alice(), &[mv("snikka", 6, 1)], None, false).unwrap_err().rejection.code(), "unknown_name");
        assert_eq!(r.execute(&alice(), &[place("rook", 6, 1)], None, false).unwrap_err().rejection, Rejection::DmOnly);

        let err = r.execute(&alice(), &[mv("rook", 4, 1)], None, false).unwrap_err();
        assert_eq!(r.state().explain(&alice(), &err.rejection), "Goblin is already at (4, 1)");
        assert_eq!(r.state().explain(&DM, &err.rejection), "Grub is already at (4, 1)");
    }

    #[test]
    fn only_creatures_hostile_to_you_by_their_own_reading_block_your_way() {
        let rook = EntityId(1);
        let mut r = room();
        assert_eq!(r.state().stance(EntityId(3), rook), Stance::Wary, "Grub sees only a human");
        assert_eq!(cost(&run(&mut r, &[mv("rook", 6, 1)])), 25, "straight through Grub's square");

        let mut r = room_with((4, 1), (7, 3));
        assert_eq!(r.state().stance(EntityId(2), rook), Stance::Hostile, "Snikka reads the Watch's colours");
        assert_eq!(r.execute(&DM, &[mv("rook", 6, 1)], None, false).unwrap_err().rejection.code(), "too_far", "the long way round");
    }

    #[test]
    fn seats_name_strangers_by_what_their_lead_reads() {
        let r = room();
        let names = &r.state().names[&alice()];
        assert_eq!(names.of(EntityId(2)).unwrap().label, "goblin");
        assert_eq!(names.of(EntityId(3)).unwrap().handle.as_str(), "goblin-2");
    }

    #[test]
    fn dry_runs_record_nothing() {
        let mut r = room();
        let st = r.execute(&DM, &[mv("rook", 6, 1)], None, true).unwrap();
        assert_eq!(st.id, StepId(2), "shows the id it would get");
        assert_eq!(r.seq(), 1);
        assert_eq!(pos(&r, 1), Cell::new(1, 1));
    }

    #[test]
    fn waiting_advances_the_clock_and_steps_record_when_they_began() {
        let mut r = room();
        run(&mut r, &[Command::Wait { seconds: 60 }]);
        let st = run(&mut r, &[mv("rook", 2, 1)]);
        assert_eq!(st.time, GameTime(60));
        assert_eq!(st.time.round(), 11);
        assert_eq!(r.execute(&alice(), &[Command::Wait { seconds: 6 }], None, false).unwrap_err().rejection, Rejection::DmOnly);
    }

    #[test]
    fn rewind_moves_the_head_and_keeps_the_rest_on_a_branch() {
        let mut r = room();
        let start = r.state().clone();
        run(&mut r, &[mv("rook", 6, 1)]);
        run(&mut r, &[mv("rook", 7, 2)]);
        let saved = r.rewind_to(StepId(1)).unwrap();
        assert_eq!(r.state(), &start);
        assert!(r.steps_since(1).is_empty());
        assert_eq!(r.timeline().branch(&saved).unwrap().head, StepId(3));
        // New steps continue from the rewound head with fresh ids.
        assert_eq!(run(&mut r, &[mv("rook", 2, 1)]).id, StepId(4));
    }

    fn toward(who: &str, target: &str) -> Command<String> {
        Command::MoveToward { who: who.into(), toward: target.into() }
    }

    fn end_of(step: &Step) -> Cell {
        let Event::CreatureMoved { path, .. } = &step.events()[0] else { panic!() };
        *path.last().unwrap()
    }

    #[test]
    fn moving_to_a_place_takes_the_cheapest_free_square_in_it() {
        let mut r = room();
        let st = run(&mut r, &[toward("rook", "rubble-strip")]);
        assert_eq!(end_of(&st), Cell::new(2, 3));
        assert_eq!(cost(&st), 10);
        // The step records an ordinary move, not the request.
        assert!(matches!(&st.input, Input::Commands(c) if matches!(c[0], Command::Move { .. })));
        let err = r.execute(&DM, &[toward("rook", "rubble-strip")], None, false).unwrap_err();
        assert_eq!(err.rejection, Rejection::AlreadyThere { who: EntityId(1), at: Cell::new(2, 3) });
    }

    #[test]
    fn occupied_squares_are_skipped() {
        let mut r = room();
        run(&mut r, &[place("rook", 1, 3), place("grub", 2, 3)]);
        let st = run(&mut r, &[toward("rook", "rubble-strip")]);
        assert_eq!(end_of(&st), Cell::new(3, 3), "Grub holds the nearest square; Rook passes through and stops past him");
    }

    #[test]
    fn moving_to_a_creature_stops_next_to_it() {
        let mut r = room();
        let st = run(&mut r, &[toward("rook", "grub")]);
        assert_eq!(end_of(&st), Cell::new(3, 1));
        assert_eq!(cost(&st), 10);
        assert_eq!(r.execute(&DM, &[toward("rook", "grub")], None, false).unwrap_err().rejection, Rejection::AlreadyThere { who: EntityId(1), at: Cell::new(3, 1) });
        assert_eq!(r.execute(&DM, &[toward("rook", "rook")], None, false).unwrap_err().rejection.code(), "already_there");
    }

    #[test]
    fn out_of_reach_is_refused_like_any_long_move() {
        let mut r = room();
        run(&mut r, &[place("rook", 1, 3)]);
        let err = r.execute(&DM, &[toward("rook", "snikka")], None, false).unwrap_err();
        assert_eq!(err.rejection, Rejection::TooFar { who: EntityId(1), to: Cell::new(7, 2), cost_ft: 35, speed_ft: 30 });
        assert_eq!(r.state().explain(&DM, &err.rejection), "(7, 2) is 35 ft away by the shortest route; Rook has 30 ft of speed");
    }

    #[test]
    fn unknown_targets_and_other_peoples_creatures_are_refused() {
        let mut r = room();
        assert_eq!(r.execute(&DM, &[toward("rook", "cellar")], None, false).unwrap_err().rejection.code(), "unknown_name");
        assert_eq!(r.execute(&alice(), &[toward("goblin", "corridor")], None, false).unwrap_err().rejection.code(), "not_yours");
        // Alice knows Snikka only as "goblin"; the DM's name for her means nothing to Alice.
        assert_eq!(r.execute(&alice(), &[toward("rook", "snikka")], None, false).unwrap_err().rejection.code(), "unknown_name");
        let st = r.execute(&alice(), &[toward("rook", "goblin-2")], None, false).unwrap();
        assert_eq!(end_of(&st), Cell::new(3, 1));
    }
}
