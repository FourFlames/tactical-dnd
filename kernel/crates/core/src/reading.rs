//! Reading a mark: walking its tree of layers with one observer's abilities.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::codex::{Attention, Codex, Facet, Gate, Layer};
use crate::id::Handle;

/// A mark on an entity: its kind in the codex, and the parameters its texts and gates use.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MarkInstance {
    pub kind: Handle,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skill {
    pub bonus: i32,
    #[serde(default)]
    pub proficient: bool,
}

/// What an observer brings to reading: what it knows, and how skilled it is.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Abilities {
    pub knows: BTreeSet<String>,
    pub skills: BTreeMap<String, Skill>,
}

impl Abilities {
    /// 10 + bonus, and passive disadvantage (−5) without proficiency, so the untrained rarely
    /// notice things in passing.
    pub fn passive(&self, skill: &str) -> i32 {
        let s = self.skills.get(skill).copied().unwrap_or_default();
        10 + s.bonus - if s.proficient { 0 } else { 5 }
    }
}

/// Rolls a skill check for an attending observer, returning the total. Passing attention never calls it.
pub type Roller<'a> = dyn FnMut(&str) -> i32 + 'a;

/// What an observer takes in from one mark at the given attention.
pub fn read(codex: &Codex, mark: &MarkInstance, who: &Abilities, attention: Attention, roll: &mut Roller) -> Vec<Facet> {
    let mut out = Vec::new();
    if let Some(kind) = codex.marks.get(&mark.kind) {
        let mut r = Reader { mark, who, attention, roll, out: &mut out };
        for layer in &kind.layers {
            r.layer(layer);
        }
    }
    out
}

/// What an observer notices of a mark without looking for it. Never rolls.
pub fn read_passing(codex: &Codex, mark: &MarkInstance, who: &Abilities) -> Vec<Facet> {
    read(codex, mark, who, Attention::Passing, &mut |_| unreachable!("passing attention never rolls"))
}

struct Reader<'a, 'r> {
    mark: &'a MarkInstance,
    who: &'a Abilities,
    attention: Attention,
    roll: &'a mut Roller<'r>,
    out: &'a mut Vec<Facet>,
}

impl Reader<'_, '_> {
    fn fill(&self, text: &str) -> String {
        let mut s = text.to_owned();
        for (k, v) in &self.mark.params {
            s = s.replace(&format!("{{{k}}}"), v);
        }
        s
    }

    fn facet(&mut self, f: &Facet) {
        self.out.push(Facet { text: self.fill(&f.text), ..f.clone() });
    }

    /// `None` if the layer needs more attention than the observer is paying; otherwise whether its gate passes.
    fn passes(&mut self, l: &Layer) -> Option<bool> {
        if l.attention > self.attention {
            return None;
        }
        Some(match &l.gate {
            Gate::None => true,
            Gate::Knows { knows } => self.who.knows.contains(&self.fill(knows)),
            Gate::Skill { skill, dc } => match self.attention {
                Attention::Passing => self.who.passive(skill) >= *dc,
                Attention::Attending => {
                    let bonus = self.who.skills.get(skill).copied().unwrap_or_default().bonus;
                    (self.roll)(skill) + bonus >= *dc
                }
            },
        })
    }

    fn layer(&mut self, l: &Layer) {
        match self.passes(l) {
            None => {}
            Some(false) => {
                if let Some(f) = &l.fallback {
                    self.facet(f);
                }
            }
            Some(true) => self.open(l),
        }
    }

    /// A layer whose gate passed: its facet, then its ladder, then its independent children.
    fn open(&mut self, l: &Layer) {
        if let Some(f) = &l.reveals {
            self.facet(f);
        }
        for rung in &l.ladder {
            if self.passes(rung) == Some(true) {
                self.open(rung);
                break;
            }
        }
        for child in &l.children {
            self.layer(child);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codex() -> Codex {
        serde_json::from_str(
            r#"{
              "identities": { "red-watch": { "label": "Red Watch", "kind": "group" } },
              "marks": {
                "book": {
                  "senses": { "sight": 1 },
                  "layers": [
                    { "reveals": { "text": "a leatherbound book", "salience": "low" } },
                    { "attention": "attending", "reveals": { "text": "it has a title" },
                      "ladder": [
                        { "gate": { "knows": "{language}" }, "reveals": { "text": "title: {title}" } },
                        { "reveals": { "text": "a title in an unknown script" } }
                      ],
                      "children": [
                        { "gate": { "skill": "arcana", "dc": 12 }, "reveals": { "text": "arcane letters" } }
                      ] }
                  ]
                },
                "red-tabard": {
                  "senses": { "sight": 3 },
                  "layers": [
                    { "reveals": { "text": "a red tabard" },
                      "children": [ { "gate": { "knows": "red-watch-insignia" },
                                      "reveals": { "text": "the Red Watch's colours", "identity": "red-watch" } } ] }
                  ]
                }
              }
            }"#,
        )
        .unwrap()
    }

    fn book() -> MarkInstance {
        MarkInstance {
            kind: Handle::new("book").unwrap(),
            params: BTreeMap::from([("title".into(), "Leaves of Ithil".into()), ("language".into(), "elvish".into())]),
        }
    }

    fn texts(f: Vec<Facet>) -> Vec<String> {
        f.into_iter().map(|f| f.text).collect()
    }

    fn who(knows: &[&str], arcana: Option<Skill>) -> Abilities {
        Abilities {
            knows: knows.iter().map(|s| s.to_string()).collect(),
            skills: arcana.into_iter().map(|s| ("arcana".to_string(), s)).collect(),
        }
    }

    #[test]
    fn passing_glance_sees_only_the_surface() {
        let f = read(&codex(), &book(), &who(&["elvish"], None), Attention::Passing, &mut |_| panic!("no rolls"));
        assert_eq!(texts(f), ["a leatherbound book"]);
    }

    #[test]
    fn attending_reads_the_title_if_you_know_the_language_and_skills_add_alongside() {
        let mut roll_15 = |_: &str| 15;
        let elf = read(&codex(), &book(), &who(&["elvish"], None), Attention::Attending, &mut roll_15);
        assert_eq!(texts(elf), ["a leatherbound book", "it has a title", "title: Leaves of Ithil", "arcane letters"]);
        let mut roll_2 = |_: &str| 2;
        let other = read(&codex(), &book(), &who(&[], None), Attention::Attending, &mut roll_2);
        assert_eq!(texts(other), ["a leatherbound book", "it has a title", "a title in an unknown script"]);
    }

    #[test]
    fn passive_skill_gates_punish_the_untrained() {
        let trained = Abilities { skills: BTreeMap::from([("arcana".into(), Skill { bonus: 2, proficient: true })]), ..Default::default() };
        let dabbler = Abilities { skills: BTreeMap::from([("arcana".into(), Skill { bonus: 2, proficient: false })]), ..Default::default() };
        assert_eq!(trained.passive("arcana"), 12);
        assert_eq!(dabbler.passive("arcana"), 7);
        assert_eq!(Abilities::default().passive("nature"), 5);
    }

    #[test]
    fn knowing_the_insignia_reveals_the_identity() {
        let tabard = MarkInstance { kind: Handle::new("red-tabard").unwrap(), params: BTreeMap::new() };
        let mut no_roll = |_: &str| unreachable!();
        let watch = read(&codex(), &tabard, &who(&["red-watch-insignia"], None), Attention::Passing, &mut no_roll);
        assert_eq!(watch[1].identity.as_ref().map(Handle::as_str), Some("red-watch"));
        assert_eq!(read(&codex(), &tabard, &who(&[], None), Attention::Passing, &mut no_roll).len(), 1);
    }
}
