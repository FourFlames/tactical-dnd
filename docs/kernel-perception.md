# Kernel: perception, identity and memory

Design agreed in the 2026-10-22 kernel session. It describes where the Rust kernel (`kernel/`) is going for
perception, social identity and memory. Build from the **Build order** at the bottom; the rest is the reasoning.
See `docs/rust-kernel-api.md` for the wider kernel priorities.

## Principles

- **No single truth of who belongs to what.** The kernel holds physical facts (positions, HP) and *marks* (what
  can be perceived). Identities such as "Red Watch" or "goblin" are never stored as fact on a creature: they are
  readings an observer makes from marks. Observers may disagree, and that's the point: stealth, infiltration and
  manipulation work by making them see differently.
- **Ids never leave the kernel.** Every observer (the DM, a player seat, later an NPC mind) has its own names
  (handles) for things. Everything sent out (views, events, rejections) is rendered for one observer in their
  names. Built: `id.rs`, `names.rs`, `observer.rs`, `view.rs`.
- **The umwelt is produced on demand.** What an agent or player knows is rendered from memory traces when it's
  needed, through the state of whoever is remembering, not stored as a brief that goes stale.
- **Every roll is an event.** Perception, contests and recall rolls are recorded, so replay is deterministic and
  asking twice doesn't reroll.

## Marks and their trees of readings

A **mark** is a concrete sign on an entity: green skin, a red tabard, a book, an accent, a salute, a shouted name.
Each mark has the **senses** it reaches, with conspicuity per sense, and a **tree of layers**. Each layer has:

- **attention** needed: `passing` (passive scores, no roll) or `attending` (an active roll); later `studying`.
- **gate**: none, *knows* something (a language, an insignia, a culture), or a *skill check* (`arcana` DC 12).
- **reveals**: a facet (text, optionally an identity, a salience) when the gate passes.
- **else**: a fallback facet when the gate fails (or nothing).
- **children**: independent facets: every child that passes is revealed.
- **ladder**: rungs tried in order; the first that passes wins. A gateless last rung is the fallback.

```
book (sight)
├─ passing              → "a leatherbound book"            [low salience]
└─ attending            → "it has a title"
   ├─ ladder (reading):
   │  ├─ knows elvish   → title: "Leaves of Ithil" (Elvish)
   │  └─ (no gate)      → "a title in an unknown script"
   ├─ nature DC 13      → "the script resembles Sylvan"
   └─ arcana DC 12      → "some of these letters turn up in arcane diagrams"
```

**Skill gates:** at `passing`, the passive score (10 + bonus) is compared with the DC, **−5 if not proficient**
(passive disadvantage), so knowledgeable characters notice these things and others rarely do. At `attending`, a
real roll with no penalty.

**Cultural codes are gates.** "Red tabard → Red Watch" is a layer gated on *knows red-watch-insignia*. An
observer's culture is the set of things it knows; there is no separate code table.

**Mark kinds live in a shared codex** (`kernel/codex/*.json`), defined once. Entities list mark instances with
parameters (`{ "kind": "book", "params": { "title": "Leaves of Ithil", "language": "elvish" } }`), substituted
into texts and gates as `{title}`, `{language}`.

**Salience is separate from knowing.** A gate decides what the observer knows; salience (conspicuity × relevance
to the observer) decides what reaches an agent's context or a player's description.

## Identities, dispositions and stance

- **Identities:** kinds (goblin, human), roles (priest, bannerman), groups (Red Watch, patrol-3, the party) and
  relational ones computed per observer (`stranger`: not one of mine). Groups can later be entities with rosters
  and orders.
- **Self-identification:** what a creature takes itself to be. It drives behaviour and which marks it displays.
- **Dispositions:** a creature's attitude toward identities (`goblin: hostile`, `stranger: wary`). Personal
  relations override them.
- **Stance** of an observer toward a target: personal relation if any; friendly toward a known fellow member of
  its own groups; otherwise the dispositions toward the identities it reads from the target's marks, most
  negative winning (placeholder rule), neutral if none apply. Scale: hostile, wary, neutral, friendly, deferential.
- **Rules use stance, not sides.** A creature's square blocks you if *it* is hostile to you, judged from its
  reading of you: a convincing disguise lets you slip past guards. Opportunity attacks, initiative and "enemy"
  will work the same way, so combat is what happens when stances turn hostile. Player characters' stance comes
  from their player's policy.

## Disguise, deception and concealment

- **Disguise and deception add marks** backed by the roll that sustains them (a stolen tabard is a real mark;
  acting like a bannerman is a behaviour mark backed by a Deception total).
- **Concealment protects marks** (Sleight of Hand for a hidden dagger); stealth hides presence entirely.
- **Contests are per mark.** Perception, Insight or Investigation against the roll behind each presented mark.
  Losing doesn't reveal "the truth": it adds a mark ("the tabard doesn't fit"), which the observer's knowledge
  then reads ("impostor?").

## Memory

- **Perception produces traces**, not beliefs: observer, the individual it was perceived as, the marks
  perceived, facets reached, the identities read, attention, time, salience.
- **Individuals bind marks together.** Each observer keeps its own *individuals*: "the robber", "the priest with
  the book", "that goblin". An individual is a bundle: the marks seen on it, bound together because they were
  seen on the same body at the same time, plus the identities read from them, accumulated across encounters.
  The observer's handle points to the individual (handle → individual → truth). An individual may not match one
  real creature: two individuals for one creature (didn't realise the hooded figure was the innkeeper), or one
  for two (twins).
- **Keep both evidence and interpretation.** A trace keeps the marks (the evidence) *and* the identities read at
  the time (the interpretation, which may have been wrong). Recognition matches current marks against an
  individual's bundle; the identities come back with it as what the observer believed then. This is what makes
  memory *misleading* without being false: the red scarf and the limp are genuinely bound to "the robber".
- **Short-term and long-term.** Passing traces sit in a short-term buffer and fade; attended, salient or rehearsed
  ones consolidate. Faded traces stay recallable with a check that gets harder with age. Needs a game clock
  (rounds in combat, minutes outside).
- **Recall(who, cue) → facets.** Recent attended traces come back automatically; faded or passing ones need a
  check. Wisdom, traits ("spacey") and conditions (drunk, exhausted, charmed) shift it. Recall rolls are events.
- **Recognition is easier than recall.** Seeing a face again yields *familiarity* ("I know you from somewhere",
  sturdy, a big bonus, even spacey characters usually get it) and, separately, *recollection* of the source
  (fragile). They can come apart.
- **Similarity weighted by distinctiveness.** Recognition compares current marks with each remembered
  individual's bundle; a red scarf
  or a limp counts for more than "human, average height", relative to what this observer has encountered.
  Conspicuous marks overshadow quiet ones at encoding. Output like *"resembles the one from the tollhouse
  robbery: red scarf, limp (face not clearly seen)"*. Players can exploit it: wear distinctive marks for a crime
  and drop them, plant them on someone else, fake a limp once.
- **Recall is lossy, not inventive.** Bad rolls forget; only deliberate effects (Modify Memory, charm, a believed
  illusion, player manipulation) plant false details. Memory edits are events, so the next recall reflects them.
- **`umwelt(who, focus)`** combines current perception and recall about the focus, ordered by salience. It
  serves NPC agent context, the DM's "what could Wren actually know about the book?", and players' private hints.

## The timeline

History is a graph of **steps**, replayed by a deterministic solver (state → event → state). Everything else
(memories, beliefs, views) is derived from it, so editing history fixes them.

- **A step is an input plus its outputs.** Input: a command, a player's button, a DM ruling or an agent's reply.
  Outputs: the events the rules produced. Plus a parent link and the step's game time. Replay folds the *inputs*
  through `decide` again and compares the new outputs with the old ones; every difference is shown to the DM.
- **Dice are tied to steps.** Each roll is seeded from (step id, roll number), so an edit elsewhere doesn't
  reshuffle the dice of steps it didn't affect.
- **External inputs keep what they were based on.** An agent reply stores the exact facts its brief contained
  (by id and content). On replay it is reused if the rebuilt brief matches; otherwise it is flagged **stale**,
  with the facts that changed. Player choices and DM rulings are kept as they are.
- **Pending agent calls stay open until they're sent.** Their brief is rebuilt from the current timeline until
  it's sent, then frozen. A reply whose brief was changed by surgery while it was out is flagged on arrival.
- **Commands that are no longer legal are dropped and flagged,** so the new timeline always follows the rules.
  "Keep as DM fiat" is one of the ways to resolve the flag. Fail gracefully, not quietly.
- **Surgery makes branches.** `insert`, `remove`, `edit` and `reorder` create a branch from the edit point and
  replay onto it. A preview shows the summary and conflict list; the DM commits (moves the main head) or
  discards. Old branches stay for comparison and undo; `rewind` is moving the head. Steps added to the main line
  during surgery are replayed onto the branch at commit.
- **Conflict resolution:** keep, drop, re-ask (run the agent again on the new brief), edit, or keep as fiat.
  Dropping or re-asking recomputes everything downstream, including what an NPC did because of a belief.
- **Who saw what's gone:** the kernel lists which seats saw events that no longer happen, so the DM knows what
  to tell the table to forget.
- **Keyframes:** state snapshots every N steps and at round boundaries; replay starts from the nearest one
  before the edit. Keyframes after an edit point belong to their own branch only.

Example: a player realises their character would never have had her helmet off while impersonating someone.
Insert *Wren wears a closed helm* (a mark concealing her face) before the scene. On replay, gob7's perception no
longer includes her face, so the trace "face of the liar from the gate" is gone, and the reply that formed
"blatant liar, not to be trusted" is flagged:

```
⚠ #812 R4  gob7 believes wren: "blatant liar, not to be trusted"
   based on: recognised the face of the liar from the gate (#790), now missing
   options: keep · drop · re-ask · edit
```

### Five kinds of time

1. **History order:** where a step sits in the graph. A retcon entered today sits at round 4. Agents never see it.
2. **Game time:** when it happened in the story. The clock is state advanced by events, so every step's game time
   comes from where it sits; an inserted step that takes time shifts everything after it on replay.
3. **When a mind learned it:** each trace keeps the game time of the step that produced it, never the time it was
   recomputed.
4. **When the mind believes it happened:** separate from 3 (testimony: *told an hour ago* about a robbery *last
   week*), and may be fuzzy or wrong (unconsciousness, drink, a spacey trait, Modify Memory).
5. **Real-world time:** logs and interface only; never shown to agents.

Briefs date memories relative to the mind's own sense of now, getting vaguer with age: "a few minutes ago",
"this morning", "about a week ago, at the gate".

### Querying it

- **Five verbs:** `history`, `why <thing>` (provenance), `knows <who> <about>` (an umwelt), `diff <a> <b>`,
  `preview <surgery>`. Shared filters: who, about, kind, rounds, area, branch.
- **Short, recent defaults:** no filter means the last 20 steps, in the asker's names, one line each.
- **One line per step, always the same shape,** with ids that can be passed straight back as arguments:
  `#812 R4 gob7: "Backs off and shouts for Grub" [routine] ← #790`.
- **Summary first, detail on request:** "3 beliefs changed, 1 move rerouted, 2 conflicts" before any list.
- **No raw state dumps:** everything is rendered for an observer, with provenance arrows for the DM.

## Agent replies: gist first, then actions, then a flag

Every agent turn (NPC minds, party agents, assistants) returns, **in this order**:

1. **Gist:** a commit-message summary written *before* anything structured: one subject line ("Backs off and
   shouts for Grub"), optionally a short body. This is the agent's gut reaction in natural language.
2. **Actions:** the structured commands and belief updates that carry the gist out.
3. **Flag:** how much attention the turn needs, with a one-line reason: `routine`, `judgement` (a call was made
   that a DM might make differently), `ambiguous` (unsure what's possible or what's going on), or `needs_dm`.

Uses:

- The gist is the step's line in history and in the DM's queue; the flag decides where it sits in the queue.
- **Gist and actions are compared.** If the gist says "flees" and the actions attack, that mismatch is itself a
  flag. Self-assessment is one signal among several: the kernel adds its own (rejected commands, stale briefs,
  gist/action mismatch, high stakes such as a creature dropping or a large move).
- The same shape works for everyone: the DM's batched actions and surgery branches carry a gist too, which
  becomes the chronicle line or the branch's description.

## Speech, pointing and sharing

- **Speech is a mark:** sound → "someone is speaking" → gate on the language → the words; fallback "a lilting
  language you don't know"; Insight on tone as a sibling. The stand-in languages plug in here.
- **Speech cues recall in listeners.** What each listener understood becomes a cue; minded NPCs get relevant
  recalls in their reaction pass (P0 reactive minds); the DM bundle shows "Wren could also know: …" for player
  characters.
- **Players get their own recalls privately** ("you recall the book had an Elvish title") and decide whether to
  speak up.
- **Sharing:** a private recall or a high-rolled facet has a share button that posts it to the chronicle and pings
  the thing on the map; for others it's testimony plus a pointer, giving them their own acquaintance with it.
- **Pointing** is an action for players, agents and NPCs: `Point { at: handle | cell }` makes a visible gesture
  (a mark) that gives whoever sees it an attention cue toward the target; it resolves "that one" in speech.
- **Sidebar** (ported from the old viewer): narrative, combat log, DM/table chat; every name and icon is a link
  that moves the camera on double-click, rendered in each viewer's own names.

## Build order

1. [x] Marks with trees, the codex, identities and dispositions; stance-based blocking replaces `Side`; seat
       labels come from passive readings. (`codex.rs`, `reading.rs`, `stance.rs`, `kernel/codex/core.json`.
       Readings are computed on the fly for now; step 2 turns them into traces.)
2. [x] The timeline: steps (input, outputs, parent, game time), the game clock, dice tied to steps, replay that
       re-decides and compares outputs, drop-and-flag, branches and surgery with preview and commit, keyframes,
       and the `history` / `diff` / `preview` queries with summary-first output. (`timeline.rs`, `surgery.rs`,
       `dice.rs`, step lines in `view.rs`; endpoints in the server. Not yet: `reorder`, history filters beyond
       branch and limit, `diff` between arbitrary branches (previews cover draft vs main), saving to disk.)
3. [ ] Passive readings producing traces during replay, stamped with game time; individuals binding marks.
4. [ ] `umwelt(who, focus)` rendering for the DM view and players; `knows` and `why` queries.
5. [ ] Memory decay, recall with recognition (familiarity and recollection), relative dating in briefs.
6. [ ] Agent replies (gist, actions, flag) with recorded briefs; stale detection; the DM queue.
7. [ ] Speech and pointing as marks; recall cued in listeners.
8. [ ] Sidebar with links and the share button.

## Open questions

- Stance combination beyond "most negative wins" (weights by salience? several dimensions such as fear,
  respect, contempt, with the scale derived from them?).
- How much testimony can override what an NPC sees for itself.
- A seat controlling several creatures: whose perception is the seat's? (Step 1 uses the seat's first creature.)
