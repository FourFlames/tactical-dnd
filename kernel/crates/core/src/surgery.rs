//! Editing history. Every edit makes a draft branch from the edit point and re-decides the steps
//! after it; the DM previews what changed, then commits the draft as the new main or discards it.

use serde::{Deserialize, Serialize};

use crate::command::Command;
use crate::event::Event;
use crate::observer::Observer;
use crate::room::Room;
use crate::timeline::{decide_input, Branch, Input, Outcome, Step, StepId, MAIN};

/// An edit to the main branch. Commands are written in the DM's names.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Surgery {
    /// A new step after `after`, by the DM.
    Insert { after: StepId, commands: Vec<Command<String>> },
    Remove { step: StepId },
    /// Replace a step's commands. Its author and dice stay.
    Edit { step: StepId, commands: Vec<Command<String>> },
    /// A dropped step gets back the events it last had, as DM fiat.
    KeepAsFiat { step: StepId },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Inserted,
    Removed,
    Edited,
    KeptAsFiat,
    /// Same creature, same destination, different route or cost.
    Rerouted,
    /// Some other difference in what the step did.
    Differs,
    /// No longer legal on this branch.
    Dropped,
    /// Was dropped, applies again.
    Recovered,
}

/// One difference between a draft and the branch it was made from.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Change {
    pub kind: ChangeKind,
    /// The step on the old branch.
    pub old: Option<StepId>,
    /// The step on the draft.
    pub new: Option<StepId>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Preview {
    pub branch: String,
    /// The last step the draft shares with main.
    pub base: StepId,
    pub head: StepId,
    pub changes: Vec<Change>,
}

struct Queued {
    by: Observer,
    gist: Option<String>,
    input: Input,
    key: Option<StepId>,
    replaces: Option<StepId>,
    /// `None`: an old step being replayed, compared with what it did before.
    new: Option<ChangeKind>,
}

impl Queued {
    fn replay(s: &Step) -> Self {
        Self { by: s.by.clone(), gist: s.gist.clone(), input: s.input.clone(), key: Some(s.key), replaces: Some(s.id), new: None }
    }
}

fn classify(old: &Outcome, new: &Outcome) -> Option<ChangeKind> {
    match (old, new) {
        (Outcome::Applied(a), Outcome::Applied(b)) if a == b => None,
        (Outcome::Applied(a), Outcome::Applied(b)) => Some(if rerouted(a, b) { ChangeKind::Rerouted } else { ChangeKind::Differs }),
        (Outcome::Applied(_), Outcome::Dropped { .. }) => Some(ChangeKind::Dropped),
        (Outcome::Dropped { .. }, Outcome::Applied(_)) => Some(ChangeKind::Recovered),
        (Outcome::Dropped { .. }, Outcome::Dropped { .. }) => None,
    }
}

fn rerouted(a: &[Event], b: &[Event]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|pair| match pair {
            (Event::CreatureMoved { who: w1, path: p1, .. }, Event::CreatureMoved { who: w2, path: p2, .. }) => w1 == w2 && p1.last() == p2.last(),
            (x, y) => x == y,
        })
}

impl Room {
    /// Makes a draft branch with the edit applied and everything after it re-decided. Main is untouched.
    pub fn surgery(&mut self, op: Surgery, gist: Option<String>) -> Result<Preview, String> {
        let head = self.timeline.head();
        let path = self.timeline.path(head);
        let index = |id: StepId| path.iter().position(|&s| s == id).ok_or_else(|| format!("{id} isn't on the main branch"));
        let editable = |id: StepId| index(id).and_then(|i| if i == 0 { Err("the room's opening can't be edited".to_string()) } else { Ok(i) });
        let rest = |i: usize| -> Vec<Queued> { path[i..].iter().map(|id| Queued::replay(&self.timeline.step(*id).unwrap().clone())).collect() };
        let in_dm_names = |at: StepId, cmds: &[Command<String>]| -> Result<Input, String> {
            let s = self.timeline.state_at(at);
            let resolved = cmds.iter().map(|c| s.resolve(&Observer::Dm, c).map_err(|r| s.explain(&Observer::Dm, &r)));
            Ok(Input::Commands(resolved.collect::<Result<_, _>>()?))
        };

        let (base, mut changes, mut queue) = match &op {
            Surgery::Insert { after, commands } => {
                let i = index(*after)?;
                let first = Queued { by: Observer::Dm, gist: gist.clone(), input: in_dm_names(*after, commands)?, key: None, replaces: None, new: Some(ChangeKind::Inserted) };
                (*after, Vec::new(), std::iter::once(first).chain(rest(i + 1)).collect())
            }
            Surgery::Remove { step } => {
                let i = editable(*step)?;
                (path[i - 1], vec![Change { kind: ChangeKind::Removed, old: Some(*step), new: None }], rest(i + 1))
            }
            Surgery::Edit { step, commands } => {
                let i = editable(*step)?;
                let old = self.timeline.step(*step).unwrap();
                let first = Queued {
                    by: old.by.clone(),
                    gist: gist.clone().or_else(|| old.gist.clone()),
                    input: in_dm_names(path[i - 1], commands)?,
                    key: Some(old.key),
                    replaces: Some(old.id),
                    new: Some(ChangeKind::Edited),
                };
                (path[i - 1], Vec::new(), std::iter::once(first).chain(rest(i + 1)).collect())
            }
            Surgery::KeepAsFiat { step } => {
                let i = editable(*step)?;
                let old = self.timeline.step(*step).unwrap();
                if !matches!(old.outcome, Outcome::Dropped { .. }) {
                    return Err(format!("{step} wasn't dropped"));
                }
                let events = self.last_applied(*step).ok_or_else(|| format!("{step} never applied on any branch"))?;
                let first = Queued { input: Input::Fiat(events), new: Some(ChangeKind::KeptAsFiat), ..Queued::replay(old) };
                (path[i - 1], Vec::new(), std::iter::once(first).chain(rest(i + 1)).collect())
            }
        };
        if let Some(q) = queue.first_mut().filter(|q| q.gist.is_none()) {
            q.gist = gist.clone();
        }

        let name = format!("draft-{}", self.timeline.peek_id().0);
        let (new_head, more) = self.replay(base, std::mem::take(&mut queue));
        changes.extend(more);
        self.timeline.set_head(&name, Branch { head: new_head, forked_at: Some(head), gist });
        Ok(Preview { branch: name, base, head: new_head, changes })
    }

    /// Makes a draft the main branch. Steps added to main since the draft was made are replayed
    /// onto it first, and what changed for them is returned. The old main stays as `before-<draft>`.
    pub fn commit(&mut self, name: &str) -> Result<Vec<Change>, String> {
        if name == MAIN {
            return Err("main is already the main branch".into());
        }
        let draft = self.timeline.branch(name).cloned().ok_or_else(|| format!("there is no branch called {name}"))?;
        let main = self.timeline.head();
        let (mut head, mut changes) = (draft.head, Vec::new());
        if let Some(fork) = draft.forked_at.filter(|&f| f != main && self.timeline.on_path(main, f)) {
            let live: Vec<Queued> =
                self.timeline.path(main).into_iter().filter(|id| *id > fork).map(|id| Queued::replay(self.timeline.step(id).unwrap())).collect();
            (head, changes) = self.replay(head, live);
        }
        let kept = Branch { head: main, forked_at: None, gist: Some(format!("main before {name} was committed")) };
        self.timeline.set_head(&format!("before-{name}"), kept);
        self.timeline.set_head(MAIN, Branch { head, forked_at: None, gist: None });
        self.timeline.remove_branch(name);
        self.state = self.timeline.state_at(head);
        Ok(changes)
    }

    pub fn discard(&mut self, name: &str) -> Result<(), String> {
        if name == MAIN {
            return Err("main can't be discarded".into());
        }
        self.timeline.remove_branch(name).map(|_| ()).ok_or_else(|| format!("there is no branch called {name}"))
    }

    /// The events a step last applied, following what it replaced back through earlier branches.
    fn last_applied(&self, mut id: StepId) -> Option<Vec<Event>> {
        loop {
            let s = self.timeline.step(id)?;
            if let Outcome::Applied(e) = &s.outcome {
                return Some(e.clone());
            }
            id = s.replaces?;
        }
    }

    /// Re-decides `queue` on top of `base`, recording new steps. Returns the new head and what changed.
    fn replay(&mut self, base: StepId, queue: Vec<Queued>) -> (StepId, Vec<Change>) {
        let mut state = self.timeline.state_at(base);
        let (mut head, mut changes) = (base, Vec::new());
        for q in queue {
            let key = q.key.unwrap_or_else(|| self.timeline.peek_id());
            let (outcome, next) = decide_input(&state, &q.input, key);
            let dropped = matches!(outcome, Outcome::Dropped { .. });
            let kind = match q.new {
                Some(_) if dropped => Some(ChangeKind::Dropped),
                Some(kind) => Some(kind),
                None => classify(&self.timeline.step(q.replaces.unwrap()).unwrap().outcome, &outcome),
            };
            let id = self.timeline.push(head, q.by, q.gist, state.clock, q.input, outcome, Some(key), q.replaces, &next);
            if let Some(kind) = kind {
                changes.push(Change { kind, old: q.replaces, new: Some(id) });
            }
            (state, head) = (next, id);
        }
        (head, changes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Cell;
    use crate::testkit::*;
    use crate::timeline::GameTime;

    fn kinds(p: &[Change]) -> Vec<ChangeKind> {
        p.iter().map(|c| c.kind).collect()
    }

    #[test]
    fn removing_a_step_replays_the_rest_and_keeps_their_dice() {
        let mut r = room();
        run(&mut r, &[mv("rook", 3, 1)]); // #2
        run(&mut r, &[mv("rook", 6, 1)]); // #3, 15 ft
        let p = r.surgery(Surgery::Remove { step: StepId(2) }, Some("Rook never stepped forward".into())).unwrap();
        assert_eq!(kinds(&p.changes), [ChangeKind::Removed, ChangeKind::Rerouted], "now 25 ft from the start");
        let replayed = r.timeline().step(p.head).unwrap();
        assert_eq!(replayed.key, StepId(3), "dice stay tied to the original step");
        assert_eq!(replayed.replaces, Some(StepId(3)));
        assert_eq!(pos(&r, 1), Cell::new(6, 1), "main is untouched until commit");
    }

    #[test]
    fn an_insert_that_blocks_the_way_drops_a_later_step_which_can_be_kept_as_fiat() {
        let mut r = room();
        run(&mut r, &[mv("rook", 6, 1)]); // #2: through wary Grub's square
        let p = r.surgery(Surgery::Insert { after: StepId(1), commands: vec![place("snikka", 3, 1)] }, None).unwrap();
        assert_eq!(kinds(&p.changes), [ChangeKind::Inserted, ChangeKind::Dropped], "hostile Snikka now holds the corridor");
        r.commit(&p.branch).unwrap();
        assert_eq!(pos(&r, 1), Cell::new(1, 1), "the dropped move didn't happen");

        let dropped = p.changes[1].new.unwrap();
        let p = r.surgery(Surgery::KeepAsFiat { step: dropped }, Some("DM: Rook slipped past anyway".into())).unwrap();
        assert_eq!(kinds(&p.changes), [ChangeKind::KeptAsFiat]);
        r.commit(&p.branch).unwrap();
        assert_eq!(pos(&r, 1), Cell::new(6, 1));
    }

    #[test]
    fn previews_read_summary_first_one_line_per_change() {
        let mut r = room();
        run(&mut r, &[mv("rook", 6, 1)]); // #2
        let gist = Some("Snikka was already in the corridor".into());
        let p = r.surgery(Surgery::Insert { after: StepId(1), commands: vec![place("snikka", 3, 1)] }, gist).unwrap();
        let lines = crate::view::preview_lines(&r, &p.changes);
        assert_eq!(lines[0], "2 changes: 1 inserted, 1 dropped");
        assert_eq!(lines[1], "· inserted #3: R1 dm: \"Snikka was already in the corridor\" — Snikka is placed at (3, 1), in the corridor");
        assert!(lines[2].starts_with("⚠ dropped #2 → #4: R1 dm ⚠ dropped: (6, 1) is "), "{}", lines[2]);
        assert!(lines[2].ends_with("; was: Rook moves 25 ft to (6, 1), in the corridor · seen by alice"), "{}", lines[2]);
    }

    #[test]
    fn editing_a_step_reroutes_what_follows() {
        let mut r = room();
        run(&mut r, &[mv("rook", 3, 1)]);
        run(&mut r, &[mv("rook", 6, 1)]);
        let p = r.surgery(Surgery::Edit { step: StepId(2), commands: vec![mv("rook", 2, 1)] }, None).unwrap();
        assert_eq!(kinds(&p.changes), [ChangeKind::Edited, ChangeKind::Rerouted]);
        assert_eq!(cost(r.timeline().step(p.head).unwrap()), 20);
    }

    #[test]
    fn commit_replays_what_happened_on_main_meanwhile_and_keeps_the_old_main() {
        let mut r = room();
        run(&mut r, &[mv("rook", 3, 1)]); // #2
        let p = r.surgery(Surgery::Edit { step: StepId(2), commands: vec![mv("rook", 2, 1)] }, None).unwrap();
        run(&mut r, &[mv("rook", 5, 1)]); // live play while the draft waits
        let old_main = r.timeline().head();
        let changes = r.commit(&p.branch).unwrap();
        assert_eq!(kinds(&changes), [ChangeKind::Rerouted], "the live move now starts from (2, 1)");
        assert_eq!(pos(&r, 1), Cell::new(5, 1));
        assert_eq!(r.timeline().branch(&format!("before-{}", p.branch)).unwrap().head, old_main);
        assert!(r.timeline().branch(&p.branch).is_none());
        assert_eq!(r.state(), &r.timeline().state_at(r.timeline().head()), "the cached state matches a fresh replay");
    }

    #[test]
    fn discard_leaves_main_alone() {
        let mut r = room();
        run(&mut r, &[mv("rook", 3, 1)]);
        let before = r.state().clone();
        let p = r.surgery(Surgery::Remove { step: StepId(2) }, None).unwrap();
        r.discard(&p.branch).unwrap();
        assert_eq!(r.state(), &before);
        assert!(r.discard(&p.branch).is_err());
    }

    #[test]
    fn inserted_time_shifts_the_game_time_of_everything_after() {
        let mut r = room();
        run(&mut r, &[mv("rook", 3, 1)]);
        let p = r.surgery(Surgery::Insert { after: StepId(1), commands: vec![Command::Wait { seconds: 600 }] }, None).unwrap();
        assert_eq!(r.timeline().step(p.head).unwrap().time, GameTime(600));
    }

    #[test]
    fn keyframes_and_replay_agree_on_long_branches() {
        let mut r = room();
        for i in 0..70 {
            run(&mut r, &[mv("rook", if i % 2 == 0 { 2 } else { 1 }, 1)]);
        }
        assert_eq!(r.state(), &r.timeline().state_at(r.timeline().head()));
        let p = r.surgery(Surgery::Insert { after: StepId(5), commands: vec![Command::Wait { seconds: 6 }] }, None).unwrap();
        r.commit(&p.branch).unwrap();
        assert_eq!(r.state(), &r.timeline().state_at(r.timeline().head()));
        assert_eq!(r.state().clock, GameTime(6));
    }
}
