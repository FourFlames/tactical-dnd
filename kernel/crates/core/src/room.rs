use std::collections::BTreeMap;

use crate::command::{Command, Rejection};
use crate::creature::{Creature, CreatureId};
use crate::def::RoomDef;
use crate::event::{Event, Recorded};
use crate::geom::Cell;
use crate::map::Map;
use crate::movement;

/// Everything true about a room right now. Only ever changed by [`RoomState::apply`].
#[derive(Clone, Debug, PartialEq)]
pub struct RoomState {
    pub name: String,
    pub map: Map,
    pub creatures: BTreeMap<CreatureId, Creature>,
}

impl RoomState {
    fn genesis(def: &RoomDef) -> Result<Self, Rejection> {
        let (map, creatures) = def.build()?;
        Ok(Self { name: def.name.clone(), map, creatures })
    }

    pub fn creature(&self, id: &CreatureId) -> Result<&Creature, Rejection> {
        self.creatures.get(id).ok_or_else(|| Rejection::new(format!("there is no creature called {id}")))
    }

    pub fn creature_at(&self, c: Cell) -> Option<&Creature> {
        self.creatures.values().find(|cr| cr.pos == c)
    }

    /// Checks a command against this state and says what would happen. Changes nothing.
    pub fn decide(&self, cmd: &Command) -> Result<Vec<Event>, Rejection> {
        match cmd {
            Command::Move { id, to } => {
                let who = self.creature(id)?;
                if !self.map.in_bounds(*to) {
                    return Err(Rejection::new(format!("{to} is off the map")));
                }
                if *to == who.pos {
                    return Err(Rejection::new(format!("{} is already at {to}", who.name)));
                }
                if let Some(t) = self.map.terrain(*to).filter(|t| t.blocks_move) {
                    return Err(Rejection::new(format!("{to} is {}", t.name)));
                }
                if let Some(other) = self.creature_at(*to) {
                    return Err(Rejection::new(format!("{} is already at {to}", other.name)));
                }
                let route = movement::route(self, who, *to)
                    .ok_or_else(|| Rejection::new(format!("{} has no way to reach {to}", who.name)))?;
                if route.cost_ft > who.speed_ft {
                    return Err(Rejection::new(format!(
                        "{to} is {} ft away by the shortest route; {} has {} ft of speed",
                        route.cost_ft, who.name, who.speed_ft
                    )));
                }
                Ok(vec![Event::CreatureMoved { id: id.clone(), path: route.path, cost_ft: route.cost_ft }])
            }
            Command::Place { id, to } => {
                self.creature(id)?;
                if !self.map.passable(*to) {
                    return Err(Rejection::new(format!("{to} isn't open floor")));
                }
                if let Some(other) = self.creature_at(*to).filter(|c| &c.id != id) {
                    return Err(Rejection::new(format!("{} is already at {to}", other.name)));
                }
                Ok(vec![Event::CreaturePlaced { id: id.clone(), to: *to }])
            }
        }
    }

    /// Folds one event in. Never fails: `decide` already checked it.
    fn apply(&mut self, event: &Event) {
        match event {
            Event::RoomOpened { .. } => unreachable!("RoomOpened only starts a log"),
            Event::CreatureMoved { id, path, .. } => {
                if let (Some(c), Some(&end)) = (self.creatures.get_mut(id), path.last()) {
                    c.pos = end;
                }
            }
            Event::CreaturePlaced { id, to } => {
                if let Some(c) = self.creatures.get_mut(id) {
                    c.pos = *to;
                }
            }
        }
    }
}

/// A room: its event log and the state folded from it.
#[derive(Clone, Debug)]
pub struct Room {
    pub id: String,
    log: Vec<Recorded>,
    state: RoomState,
}

impl Room {
    pub fn open(id: impl Into<String>, def: RoomDef) -> Result<Self, Rejection> {
        let state = RoomState::genesis(&def)?;
        let log = vec![Recorded { seq: 1, event: Event::RoomOpened { def } }];
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

    /// Runs a batch of commands atomically: each sees the effects of the ones before it, and if
    /// any is refused, nothing is committed. Returns the recorded events, or the index of the
    /// refused command and why. With `dry_run`, nothing is committed either way.
    pub fn execute(&mut self, cmds: &[Command], dry_run: bool) -> Result<Vec<Recorded>, (usize, Rejection)> {
        let mut scratch = self.state.clone();
        let mut seq = self.seq();
        let mut out = Vec::new();
        for (i, cmd) in cmds.iter().enumerate() {
            for event in scratch.decide(cmd).map_err(|r| (i, r))? {
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
    pub fn rewind_to(&mut self, seq: u64) -> Result<(), Rejection> {
        if seq == 0 {
            return Err(Rejection::new("can't rewind past the room's opening"));
        }
        self.log.truncate(self.log.partition_point(|r| r.seq <= seq));
        self.state = Self::fold(&self.log)?;
        Ok(())
    }

    fn fold(log: &[Recorded]) -> Result<RoomState, Rejection> {
        let (first, rest) = log.split_first().ok_or_else(|| Rejection::new("empty log"))?;
        let Event::RoomOpened { def } = &first.event else {
            return Err(Rejection::new("the log doesn't start with the room opening"));
        };
        let mut state = RoomState::genesis(def)?;
        for r in rest {
            state.apply(&r.event);
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::creature::Side;
    use crate::def::CreatureDef;
    use crate::map::Terrain;

    fn terrain(name: &str, blocks: bool, difficult: bool) -> Terrain {
        Terrain { name: name.into(), blocks_move: blocks, blocks_sight: blocks, difficult }
    }

    fn room() -> Room {
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
                CreatureDef { id: "rook".into(), name: "Rook".into(), side: Side::Party, at: Cell::new(1, 1), speed_ft: 30, hp: 20 },
                CreatureDef { id: "gob".into(), name: "Goblin".into(), side: Side::Hostile, at: Cell::new(7, 3), speed_ft: 30, hp: 7 },
            ],
        };
        Room::open("t", def).unwrap()
    }

    fn mv(id: &str, x: i32, y: i32) -> Command {
        Command::Move { id: id.into(), to: Cell::new(x, y) }
    }

    #[test]
    fn moves_along_open_floor() {
        let mut r = room();
        let ev = r.execute(&[mv("rook", 6, 1)], false).unwrap();
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].seq, 2);
        assert_eq!(r.state().creatures[&"rook".into()].pos, Cell::new(6, 1));
    }

    #[test]
    fn routes_around_walls_and_refuses_beyond_speed() {
        let mut r = room();
        r.execute(&[mv("rook", 1, 3)], false).unwrap();
        // Through the rubble is 45 ft; back round the top of the wall is 40. Both are past 30 ft of speed.
        let err = r.execute(&[mv("rook", 6, 3)], false).unwrap_err();
        assert_eq!(err.0, 0);
        assert!(err.1.reason.contains("ft away"), "{}", err.1);
    }

    #[test]
    fn routes_run_straight() {
        let mut r = room();
        let ev = r.execute(&[mv("rook", 5, 1)], false).unwrap();
        let crate::event::Event::CreatureMoved { path, cost_ft, .. } = &ev[0].event else { panic!() };
        assert_eq!(*cost_ft, 20);
        assert!(path.iter().all(|c| c.y == 1), "{path:?}");
    }

    #[test]
    fn difficult_terrain_costs_double_to_leave_not_to_enter() {
        let cost = |ev: &[Recorded]| match &ev[0].event {
            crate::event::Event::CreatureMoved { cost_ft, .. } => *cost_ft,
            e => panic!("{e:?}"),
        };
        let mut r = room();
        r.execute(&[Command::Place { id: "rook".into(), to: Cell::new(1, 3) }], false).unwrap();
        assert_eq!(cost(&r.execute(&[mv("rook", 2, 3)], false).unwrap()), 5, "stepping into rubble");
        assert_eq!(cost(&r.execute(&[mv("rook", 3, 3)], false).unwrap()), 10, "rubble to rubble");
        r.execute(&[Command::Place { id: "rook".into(), to: Cell::new(6, 3) }], false).unwrap();
        assert_eq!(cost(&r.execute(&[mv("rook", 7, 2)], false).unwrap()), 10, "stepping out of rubble");
    }

    #[test]
    fn hostile_squares_block_and_batches_are_atomic() {
        let mut r = room();
        let before = r.state().clone();
        let err = r.execute(&[mv("rook", 6, 1), mv("rook", 7, 3)], false).unwrap_err();
        assert_eq!(err.0, 1, "the second move ends on the goblin");
        assert_eq!(r.state(), &before);
        assert_eq!(r.seq(), 1);
    }

    #[test]
    fn dry_run_and_rewind_leave_no_trace() {
        let mut r = room();
        r.execute(&[mv("rook", 6, 1)], true).unwrap();
        assert_eq!(r.seq(), 1);
        let start = r.state().clone();
        r.execute(&[mv("rook", 6, 1), mv("rook", 7, 2)], false).unwrap();
        assert_eq!(r.seq(), 3);
        r.rewind_to(1).unwrap();
        assert_eq!(r.state(), &start);
        assert!(r.events_since(1).is_empty());
    }
}
