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

## The DM's tools, latency and batching

The DM (an Opus in Claude Code) works through `dm`, a command-line tool over the server (`kernel/DM.md`).
The first version is deliberately naive; it is measured from the start so the next versions can be
chosen by numbers, not guesses.

**What exists:**

- **An inbox.** A player's message is acknowledged at once ("Sent to the DM."), told "The DM is
  reading…" when the DM's wake returns it, and gets the replies live. Every hop is timed: sent → DM saw
  it → first reply → done, plus command execution time (`dm stats`, p50 and p95).
- **Wakes are batched.** `dm wait` blocks until a message arrives, then waits a short window (250 ms) for
  others to join, and returns them all as one bundle.
- **The bundle answers the obvious questions up front:** the speaker's sheet, what they pointed at
  (resolved from their names, with distance or terrain and occupant), who's within 30 ft and how they
  stand, the last five steps. Target: a routine message needs no lookup calls, so one `act` and one
  `reply`.
- **A short command language** (`move rook 4,5; wait 1 round`), parsed by the kernel, so the DM never
  writes JSON and typed player text can later go through the same parser.

**Latency budget (from the post-mortem):** acknowledgement under 5 s (now: instant), routine resolution
under 15 s, a ruling with a roll under 30 s. The DM's own thinking dominates; everything the kernel does
should stay in milliseconds.

**Batching: options to try, in rough order.**

1. *Now:* one fixed window per wake. Simple; the cost is that the DM wakes once per burst of messages.
2. *Quiet and loud:* only some things wake the DM (a question, a ruling, a deferred property); quiet ones
   (moves, End turn) ride along with the next loud one. The Node engine did this and it helped.
3. *Adaptive windows:* a longer window while the DM is mid-reply (more will pile up anyway), shorter when
   idle; a priority item (an opportunity attack, a player mid-turn) skips the window.
4. *Pre-drafting:* a cheap model drafts the response to each message the moment it arrives, so the DM's
   wake carries a draft to approve (see "Drafter evaluation" in `docs/rust-kernel-api.md`).
5. *Skip the DM:* plain mechanical text ("move to 4,5") parsed and run by the server directly.

**The session journal.** An append-only operations log, separate from the timeline: surgery never
rewrites it, so a rewound or replaced step stays in it with the rewind after it. It exists for
post-mortems: which player messages turned into what, which could have been handled without the DM,
which tools the DM reached for and didn't have.

- `kernel/sessions/<room>-<date>/journal.log`, one line per event, always
  `<time> <ref> <verb> <actor> <payload> [key=value …]`. Refs are prefixed so one grep finds an item's
  whole story: `m3` messages, `#12` steps, `draft-15` branches, `w7` wakes, `?` for lines that belong
  to nothing yet (parse errors, refusals, wishes). `journal.jsonl` is the same with structured facts.
- Verbs: `open`, `sent`, `wake` (`batch`, `waited`, and `late` or `idle`: whether messages were already
  waiting when the DM called, or the DM sat waiting), `reply`, `done`, `step` (`cmd`, `game`, `took`),
  `dry`, `refused` (`code`), `parse`, `preview`, `commit`, `discard`, `rewind`, `wish`.
- Steps and refusals carry `re=m3` when the DM tags them (`dm act … --re 3`); untagged DM steps get the
  open message the DM saw most recently, written `re=m3?` (a guess; `grep -w re=m3` finds both).
  Replies always link to their message. A seat's own clicks get no guess.
- Until rooms are saved, each server start is a session of its own (`…-2`, `-3`), so refs stay unique
  within a journal.
- `dm review` sorts every message: *could have skipped the DM* (its steps only moved the sender's own
  creatures), *answered without a step* (did the bundle already hold the answer?), *rulings*, *still
  open*; then the slowest waits with their hops, wishes, parse errors grouped by the missing command
  (the `dm` tool's unknown subcommands count too), refusals by code, and fiat (places, inserted places,
  dropped steps kept).

**Deferred properties.** Some things aren't decided until someone looks closely: what's in the chest,
what this flower does in a potion. A mark can carry a *deferred* layer: when an observer first reaches it
(attending, with the right gate), the kernel can't answer alone and queues a `needs_dm` item for it
(`deferred: chest.contents, wren attending`). To keep that fast:

- The DM can decide deferred properties **ahead of time**: whenever the DM is idle, the queue offers the
  deferred properties nearest to being reached ("Wren is two squares from the chest"), so most are
  settled before anyone asks.
- A cheap model can **draft** a value for the DM to approve, within limits set in the codex (a loot
  table, a list of plausible alchemical effects).
- The answer becomes a step (setting the mark's parameters), so it is in history like everything else
  and survives surgery.

**NPC turns** should go by quickly: the turn's agent call is pre-thought in the background the moment
the turn becomes likely (see "Reactive minds" in the API doc), routine flags never wake the DM, and the
DM's queue only shows what needs a decision.

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

## Space and places

Agreed in the 2026-10-23 session. Space should be **seamless**: no hard edges between maps, rooms, floors
or scales, and moving between them never means loading a new encounter. The old engine's limits (one
fixed grid per encounter, one height per square, map edits in side tables, whole-map visibility,
straight-line sound; see `docs/kernel-port-inventory.md` Appendix B) are what this design removes.
**Design rule:** every choice in the graph structure is judged by how easy it makes seamless traversal
and navigation for the DM and for agents.

### Frames, grids and portals

- **A frame** is a local 5 ft grid with its own position and orientation in the world. Most frames never
  move; a ship, a hanging bridge, a wagon or a collapsing floor is a frame whose transform changes.
- **Portals** stitch neighbouring frames together (a doorway, a gangplank, the end of a bridge). Pathing,
  line of sight and sound cross them.
- **Positions** are (frame, square, level), not a bare (x, y). A square may hold several standing
  surfaces (floor, balcony, bridge over a chasm); walls and doors sit on the edges between squares.
- **Terrain changes are events** (a square's floor, an edge's wall or door), so a collapse, a fire or a
  cut rope is in history and survives surgery like everything else.
- The rules never touch the storage. They ask a narrow `Space` interface: neighbours and step cost,
  sight line and cover between two points, the surface at a point, the place a point is in. The first
  implementation is one static frame (today's maps); moving frames and stacked surfaces arrive behind
  the same interface.

### Places

A **place** is an entity like a creature: an id that never leaves the kernel, and a handle per observer.

- **A parent:** the altar is in the nave, the nave in the shrine, the shrine in Greyhold. One parent per
  place keeps the tree clean and answers "where am I?" at every zoom.
- **Memberships** for areas that overlap or are political or administrative: the market district across
  three streets, Red Watch territory, the baron's lands. They exist mostly to give NPCs beliefs about
  who belongs where and who may go where, so a new NPC can be added quickly with the right territorial
  beliefs, and so NPCs who reappear can be updated: the DM reads the history of territory-changing
  events to decide what is now common knowledge and how people act.
- **Links** between places, each saying what it is and what it costs: a portal on a grid (`door1`, open
  or locked) or an abstract route ("the north road, 2 days, bandit country"). Links make a coarse
  navigation graph: "how do I get from the tavern to the docks" is answered in places.
- **An optional extent:** the squares a place owns in a frame. A place may have no geometry at all yet.
  The capital can be talked about and travelled to before anyone has drawn it.
- **Properties** (light, ambience, owner, prices, claims) are added when something needs them.

**Actualizing.** The tactical grid only exists where play is close up. When the party arrives at an
abstract place, it is turned into a grid: the DM decides (or approves a cheap model's draft) what's
there, the same way as deferred properties, and that becomes a step in history. Journeys move along
abstract links with game time. Mobile places (ship, wagon, caravan, camp) are places on a moving frame,
and their sub-places move with them; building a home or a camp is adding sub-places and links.
Out-of-combat displays come later.

### Two-level navigation and sound

- **Pathing** routes through the place graph first, then fine-paths squares only inside the places on
  that route (hierarchical pathfinding, as games do it).
- **Sound** spreads along links: through the open door and down the corridor, not straight through
  walls. Closed doors, walls and distance soak it (the old engine's 30/20/10 ft muffling is the
  starting table).
- **Visibility** can be precomputed coarsely between places (which places can see into which, like a
  game's potentially-visible sets) and refined to squares only where it matters, with results cached
  per observer and per version.

### Mental maps

Each mind has its own map: the places it knows, the links it believes in, its own names for them, and
what it believes about them (open, blocked, dangerous, whose territory). The cook knows the back door
and the new guard doesn't. Beliefs can be stale (a path collapsed since) or planted (an illusion of a
wall, being told the bridge is out, a deliberately wrong map). Briefs describe space the way a person
would: "You're in the kitchen. The hall is through the north door; the yard is out the back." This is
what the old engine's "reachable region" fix was reaching for: "by now it could be in the yard or the
stables" is a query on the mind's own map.

### Talking about space, and combat

Agents, players and the DM speak in places ("go to the stables", "Tobin was last seen in the yard"),
and the kernel resolves them to squares; `dm look` and the wake bundle say "in the nave, 10 ft from the
altar". In combat that isn't enough on its own: a ranged character wants to know whether they can reach
a good perch this turn and what they could hit from it. So the kernel answers **vantage queries** in the
asker's terms, from what the asker knows:

- `vantage(who, toward)`: squares reachable this turn (or with a dash) that see the target or place,
  ranked by cover and range, each named by where it is: "the gallery rail, 25 ft, sees the yard, half
  cover".
- Agents may reason loosely ("get up high and cover the yard") and leave the details to a default:
  move to the best vantage and **ready** an attack on the first hostile that appears there.

### Simulation detail follows places

- The place the party is in and its neighbours run in full detail. Further away, NPCs move along links
  and act in coarse steps ("the patrol reaches the gate in about ten minutes"). Decisions are batched by
  place and level of detail, to keep model calls (DeepSeek and others) down.
- **Interesting near the party, but never omniscient.** Things may be a little more eventful where the
  players are: more of the world is simulated finely there, and the DM can choose which distant threads
  to advance or bring closer. But no NPC acts on what it doesn't know: if the players act naturally or
  stay hidden, the guards behave as they would anyway. Drama comes from what the world chooses to
  bring the party's way, never from NPCs sensing them.

## Build order

1. [x] Marks with trees, the codex, identities and dispositions; stance-based blocking replaces `Side`; seat
       labels come from passive readings. (`codex.rs`, `reading.rs`, `stance.rs`, `kernel/codex/core.json`.
       Readings are computed on the fly for now; step 2 turns them into traces.)
2. [x] The timeline: steps (input, outputs, parent, game time), the game clock, dice tied to steps, replay that
       re-decides and compares outputs, drop-and-flag, branches and surgery with preview and commit, keyframes,
       and the `history` / `diff` / `preview` queries with summary-first output. (`timeline.rs`, `surgery.rs`,
       `dice.rs`, step lines in `view.rs`; endpoints in the server. Not yet: `reorder`, history filters beyond
       branch and limit, `diff` between arbitrary branches (previews cover draft vs main), saving to disk.)
   - [x] The DM's tools: the `dm` command line, the inbox with instant acknowledgement, batched wakes with
         a context bundle, timed hops (`dm stats`), the short command language. (Next: quiet/loud, the
         `needs_dm` queue for non-message items, deferred properties.)
   - [x] The session journal: `kernel/sessions/<room>-<date>/journal.log` (+ `journal.jsonl`), one line per
         message, wake, reply, step, refusal, parse error, surgery and rewind; `--re` tags; `dm log`,
         `dm wish`, `dm review`. (`crates/server/src/journal.rs`. Next: agent-call lines `a4`, a session
         that continues across restarts once rooms are saved.)
   - [ ] **The playable slice** (agreed 2026-10-23; before step 3, so there's a game to test perception in):
         P1 save rooms to disk · P2 space v1 behind the `Space` interface (one static frame, per-square
         height, typed terrain, edge walls and doors as events, pathing with climb cost, 3D distance, sight
         and cover) with a small place layer (the tree, links tied to doors, "which place is this square
         in", place names in the journal, bundle and narration) · P3 stat blocks, seeded rolls, check, save,
         ruling · P4 initiative, turns, attacks, damage, conditions · P5 opportunity attacks and offers ·
         P6 the table UI (seat codes, turn HUD, route preview, offers dialog, inspect card, chronicle).
         Details and the source of each piece: `docs/kernel-port-inventory.md`.
3. [ ] Passive readings producing traces during replay, stamped with game time; individuals binding marks.
4. [ ] `umwelt(who, focus)` rendering for the DM view and players; `knows` and `why` queries.
5. [ ] Memory decay, recall with recognition (familiarity and recollection), relative dating in briefs.
6. [ ] Agent replies (gist, actions, flag) with recorded briefs; stale detection; the DM queue.
7. [ ] Speech and pointing as marks; recall cued in listeners.
8. [ ] Sidebar with links and the share button.

## Open questions

- Places: polygons or square sets for extents; how memberships carry rules ("may enter") vs beliefs; how
  far coarse simulation goes before an off-screen NPC needs a model call.

- Stance combination beyond "most negative wins" (weights by salience? several dimensions such as fear,
  respect, contempt, with the scale derived from them?).
- How much testimony can override what an NPC sees for itself.
- A seat controlling several creatures: whose perception is the seat's? (Step 1 uses the seat's first creature.)
