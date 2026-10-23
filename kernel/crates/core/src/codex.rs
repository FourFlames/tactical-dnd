//! The codex: shared definitions of identities and mark kinds, written once and used by every room.
//! See docs/kernel-perception.md.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::id::Handle;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Codex {
    #[serde(default)]
    pub identities: BTreeMap<Handle, IdentityDef>,
    #[serde(default)]
    pub marks: BTreeMap<Handle, MarkKind>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IdentityDef {
    /// How it reads in a sentence: "goblin", "Red Watch", "priest".
    pub label: String,
    pub kind: IdentityKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityKind {
    /// What something is: goblin, human.
    Kind,
    /// What someone does: priest, bannerman.
    Role,
    /// Something with members: the Red Watch, a patrol, the party.
    Group,
    /// Worked out per observer, never read from marks: stranger.
    Relational,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sense {
    Sight,
    Hearing,
    Smell,
    Touch,
}

/// A kind of perceivable sign, and the tree of readings an observer can make of it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MarkKind {
    /// The senses it reaches, with conspicuity (0 = barely, 3 = can't miss it).
    pub senses: BTreeMap<Sense, u8>,
    pub layers: Vec<Layer>,
}

/// One step of interpretation. Texts and gates may use `{param}` placeholders, filled from the
/// mark instance's params.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    #[serde(default)]
    pub attention: Attention,
    #[serde(default)]
    pub gate: Gate,
    #[serde(default)]
    pub reveals: Option<Facet>,
    /// Revealed instead when the gate fails.
    #[serde(default, rename = "else")]
    pub fallback: Option<Facet>,
    /// Independent readings: every one that passes is revealed.
    #[serde(default)]
    pub children: Vec<Layer>,
    /// Rungs tried in order: the first that passes wins. A gateless last rung is the fallback.
    #[serde(default)]
    pub ladder: Vec<Layer>,
}

/// How closely the observer is looking. Ordered: attending reaches everything passing does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Attention {
    /// Passive scores, no roll: what you'd notice anyway.
    #[default]
    Passing,
    /// An active look: real rolls.
    Attending,
}

/// Written as `{"knows": "elvish"}` or `{"skill": "arcana", "dc": 12}`; omitted means no gate.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Gate {
    /// Something the observer knows: a language, an insignia, a culture's signs.
    Knows { knows: String },
    Skill { skill: String, dc: i32 },
    #[default]
    None,
}

/// A piece of what an observer takes in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Facet {
    pub text: String,
    /// The identity this reading suggests, if any.
    #[serde(default)]
    pub identity: Option<Handle>,
    #[serde(default)]
    pub salience: Salience,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Salience {
    Low,
    #[default]
    Normal,
    High,
}

impl Codex {
    /// Merges another codex file in. Later definitions of the same handle replace earlier ones.
    pub fn merge(&mut self, other: Codex) {
        self.identities.extend(other.identities);
        self.marks.extend(other.marks);
    }

    /// Checks that every identity a mark kind suggests is defined.
    pub fn check(&self) -> Result<(), String> {
        fn walk(codex: &Codex, mark: &Handle, layers: &[Layer]) -> Result<(), String> {
            for l in layers {
                for f in l.reveals.iter().chain(&l.fallback) {
                    if let Some(id) = f.identity.as_ref().filter(|id| !codex.identities.contains_key(*id)) {
                        return Err(format!("mark {mark} suggests identity {id}, which the codex doesn't define"));
                    }
                }
                walk(codex, mark, &l.children)?;
                walk(codex, mark, &l.ladder)?;
            }
            Ok(())
        }
        for (handle, kind) in &self.marks {
            walk(self, handle, &kind.layers)?;
        }
        Ok(())
    }
}
