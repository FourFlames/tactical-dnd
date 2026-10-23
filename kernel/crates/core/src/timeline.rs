//! The timeline: a graph of steps, replayed by a deterministic solver (state → events → state).
//! Every other kind of state is derived from it. See docs/kernel-perception.md, "The timeline".
//!
//! A step is an *input* (a command batch, DM fiat, the room's opening) plus the *outcome* the rules
//! produced from it. Steps never change once made: editing history makes a new branch whose steps
//! were re-decided from the inputs, and the old branch stays for comparison and undo.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use serde::{Deserialize, Deserializer, Serialize};

use crate::codex::Codex;
use crate::command::{Command, Rejection};
use crate::def::RoomDef;
use crate::dice::Dice;
use crate::event::Event;
use crate::observer::Observer;
use crate::room::RoomState;

/// A step's id. Ids increase along every branch and are never reused. Written `#12`; accepted as
/// `12` or `"#12"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct StepId(pub u64);

impl std::fmt::Display for StepId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "#{}", self.0)
    }
}

impl<'de> Deserialize<'de> for StepId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            N(u64),
            S(String),
        }
        match Raw::deserialize(d)? {
            Raw::N(n) => Ok(StepId(n)),
            Raw::S(s) => s.trim().trim_start_matches('#').parse().map(StepId).map_err(serde::de::Error::custom),
        }
    }
}

/// Game time: seconds since the room opened. A round is six seconds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GameTime(pub u64);

impl GameTime {
    pub fn round(self) -> u64 {
        self.0 / 6 + 1
    }
}

impl std::fmt::Display for GameTime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "R{}", self.round())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Input {
    /// The first step of every room.
    Open { def: Arc<RoomDef>, codex: Arc<Codex> },
    /// A batch of resolved commands, decided atomically.
    Commands(Vec<Command>),
    /// Events applied as they are, unchecked: a DM ruling, or a dropped step kept as fiat.
    Fiat(Vec<Event>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Applied(Vec<Event>),
    /// The input is no longer legal on this branch (after an edit to the past). Flagged, not hidden.
    Dropped { index: usize, rejection: Rejection },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    pub id: StepId,
    pub parent: Option<StepId>,
    /// Steps from the root (0) along this branch.
    pub depth: u32,
    /// Seeds this step's dice: the id of the step as first entered. Replays keep it.
    pub key: StepId,
    /// The step this one re-decides, on the branch it was replayed from.
    pub replaces: Option<StepId>,
    pub by: Observer,
    /// The author's commit-message summary, if they gave one.
    pub gist: Option<String>,
    /// Game time when the step began.
    pub time: GameTime,
    pub input: Input,
    pub outcome: Outcome,
}

impl Step {
    pub fn events(&self) -> &[Event] {
        match &self.outcome {
            Outcome::Applied(e) => e,
            Outcome::Dropped { .. } => &[],
        }
    }
}

pub const MAIN: &str = "main";

#[derive(Clone, Debug, PartialEq)]
pub struct Branch {
    pub head: StepId,
    /// For a draft: the main head when it was made, so commit can replay what happened since.
    pub forked_at: Option<StepId>,
    pub gist: Option<String>,
}

/// Decides an input against `state` with dice keyed by `key`. Returns the outcome and the state after it.
pub fn decide_input(state: &RoomState, input: &Input, key: StepId) -> (Outcome, RoomState) {
    let mut next = state.clone();
    let events = match input {
        Input::Open { .. } => unreachable!("only the root opens a room"),
        Input::Fiat(events) => events.clone(),
        Input::Commands(cmds) => {
            let mut dice = Dice::new(key);
            let mut out = Vec::new();
            for (index, cmd) in cmds.iter().enumerate() {
                match next.decide(cmd, &mut dice) {
                    Ok(events) => {
                        for e in &events {
                            next.apply(e);
                        }
                        out.extend(events);
                    }
                    Err(rejection) => return (Outcome::Dropped { index, rejection }, state.clone()),
                }
            }
            return (Outcome::Applied(out), next);
        }
    };
    for e in &events {
        next.apply(e);
    }
    (Outcome::Applied(events), next)
}

const KEYFRAME_EVERY: u32 = 32;

#[derive(Clone, Debug)]
pub struct Timeline {
    steps: BTreeMap<StepId, Step>,
    branches: BTreeMap<String, Branch>,
    keyframes: HashMap<StepId, RoomState>,
    next: u64,
}

impl Timeline {
    pub fn open(def: RoomDef, codex: Arc<Codex>) -> Result<(Self, RoomState), String> {
        let state = RoomState::genesis(&def, codex.clone())?;
        let root = StepId(1);
        let step = Step {
            id: root,
            parent: None,
            depth: 0,
            key: root,
            replaces: None,
            by: Observer::Dm,
            gist: Some(format!("Open {}", def.name)),
            time: GameTime(0),
            input: Input::Open { def: Arc::new(def), codex },
            outcome: Outcome::Applied(Vec::new()),
        };
        let t = Self {
            steps: BTreeMap::from([(root, step)]),
            branches: BTreeMap::from([(MAIN.to_owned(), Branch { head: root, forked_at: None, gist: None })]),
            keyframes: HashMap::from([(root, state.clone())]),
            next: 2,
        };
        Ok((t, state))
    }

    pub fn step(&self, id: StepId) -> Option<&Step> {
        self.steps.get(&id)
    }

    pub fn branch(&self, name: &str) -> Option<&Branch> {
        self.branches.get(name)
    }

    pub fn branches(&self) -> impl Iterator<Item = (&String, &Branch)> {
        self.branches.iter()
    }

    pub fn head(&self) -> StepId {
        self.branches[MAIN].head
    }

    /// The id the next step will get.
    pub fn peek_id(&self) -> StepId {
        StepId(self.next)
    }

    /// Root to `head`, in order.
    pub fn path(&self, head: StepId) -> Vec<StepId> {
        let mut out = vec![head];
        while let Some(p) = self.steps[out.last().unwrap()].parent {
            out.push(p);
        }
        out.reverse();
        out
    }

    pub fn on_path(&self, head: StepId, id: StepId) -> bool {
        let mut cur = Some(head);
        while let Some(c) = cur {
            if c == id {
                return true;
            }
            if c < id {
                return false; // ids only grow along a branch
            }
            cur = self.steps[&c].parent;
        }
        false
    }

    /// The state after `id`: from the nearest keyframe at or before it, folding forward.
    pub fn state_at(&self, id: StepId) -> RoomState {
        let mut chain = Vec::new();
        let mut cur = id;
        loop {
            if let Some(k) = self.keyframes.get(&cur) {
                let mut s = k.clone();
                for sid in chain.iter().rev() {
                    for e in self.steps[sid].events() {
                        s.apply(e);
                    }
                }
                return s;
            }
            chain.push(cur);
            cur = self.steps[&cur].parent.expect("the root always has a keyframe");
        }
    }

    /// Records a step on top of `parent`. `after` is the state once it's applied (for keyframes).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn push(
        &mut self,
        parent: StepId,
        by: Observer,
        gist: Option<String>,
        time: GameTime,
        input: Input,
        outcome: Outcome,
        key: Option<StepId>,
        replaces: Option<StepId>,
        after: &RoomState,
    ) -> StepId {
        let id = StepId(self.next);
        self.next += 1;
        let depth = self.steps[&parent].depth + 1;
        if depth.is_multiple_of(KEYFRAME_EVERY) {
            self.keyframes.insert(id, after.clone());
        }
        let step = Step { id, parent: Some(parent), depth, key: key.unwrap_or(id), replaces, by, gist, time, input, outcome };
        self.steps.insert(id, step);
        id
    }

    pub(crate) fn set_head(&mut self, name: &str, branch: Branch) {
        self.branches.insert(name.to_owned(), branch);
    }

    pub(crate) fn remove_branch(&mut self, name: &str) -> Option<Branch> {
        self.branches.remove(name)
    }
}
