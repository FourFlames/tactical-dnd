# NPC minds v3: entities, attention and memory (design)

Status: **design, not built.** Builds on `docs/stealth.md` (minds v2). Written after the Greyhold Barracks playtest (2026-10-10), whose failures it is meant to fix. Correct the shape here before code.

## 1. The paradigm

The engine is a set of **symworlds**: formal worlds (physics, perception, a universal psychology of habit, the social protocol of rank and orders) in which conclusions follow *deductively* from that world's axioms. "A glimpse warrants 0.5 certainty" is not a sloppy deduction; it is an axiom of the perception world. Models do what no symworld can: interpretation, hypothesis, choice, character. Induction and abduction between and beyond the worlds.

Two rules follow, and every playtest failure broke one of them:

1. **The engine never hands a model a deduction to make.** If something follows necessarily from what a mind knows, the engine states it in plain words. (Dace read "last seen on the sand" as "is on the sand" for four rounds while looking at the empty sand. DeepSeek reasons about "last seen" flawlessly when asked cleanly; the brief asked badly.)
2. **The engine never makes a judgment call wearing deterministic clothes.** If a rule has to guess intent, either the world's axioms are too vague or the question belongs to a model. (The nearest-standable-square guess sent Tobin outside the north wall; the fallback picked Hennick's stale order over the Commander's newer one.)

And one interface rule: **the brief is a contract.** Fixed sections, fixed formats, negatives stated outright. A model should never have to guess what a line means.

### Observer-shaped description

The engine describes the world through each character's senses, attention, knowledge and identities. Human-controlled and model-controlled characters use the same observer pipeline; control only decides who supplies the decisions.

- **Marks** are the observable features an entity presents: a face, a grey tabard with a red cord, red hair, a drawn sword, five apples in a barrel. Marks belong to an entity's *presentation*, which can differ from its truth (a disguise, an illusion, a mimic presenting as a chest).
- **Perception supplies the available marks. Attention decides which are noticed (§6). Recognition connects noticed combinations to referents the observer already holds** (people, groups, species, objects; §2.4). An identification can make further marks relevant and direct closer inspection.
- **Interests shape salience.** A guard notices "flowers beside the path"; a herbalist notices petal count and leaf arrangement. Personality emerges through what characters notice.
- **Checks map onto stages.** Perception and Investigation change what is available or noticed. Nature, Arcana, History, Religion and Insight change what is recognised from marks already noticed; they never reveal a mark the character hasn't perceived.
- **Illusions** present apparent marks. A conflict between senses, or with expected consequences, is a reason to examine, question or test. The usual Investigation check against the spell's DC still decides whether the character sees through it.
- **Three states of evidence stay distinct:** unavailable (couldn't be perceived), unattended (could have been, wasn't noticed) and noticed. Private evidence stays with its observer. Every observation and deduction cites its source events, so the player's log and each agent's brief are traceable accounts of their own experience.

Marks start small and grow with play. Coarse marks come by default from an entity's kind and tags (species, gear, insignia, face shown or covered, what's in hand, voice); fine marks exist only where an encounter or a ruling puts them (`describe`, `evidence`). This layer sits on top of the entity and knowledge layer (§2) and is built after it (§10).

## 2. One layer for everything a mind can know about

Today the same idea is built five times, ad hoc:

| Thing | Truth | Per-mind record | News when |
|---|---|---|---|
| Doors | `walls[].open` | `m.doors` (state as last seen) | seen differently from memory |
| Creatures | `creatures` | `m.tracks` (last seen where/when/how clearly) | *missing: gone from where they were* |
| Stories | — | `m.claims` (text, sources, relays) | new source or new detail; *missing: two stories about the same person* |
| Orders | — | `m.orders` (per-listener status) | *missing: done, superseded, abandoned* |
| Items | *missing* | *missing* | *missing: the apple count is short* |

v3 makes these one thing.

### 2.1 Entities (the truth)

`s.entities[id] = { id, kind, name, state, at, tags, presents }` plus the existing creatures and walls, which keep their storage but are addressed the same way.

- `kind`: `creature | item | task | door | place | group | story`.
- **Physical or conventional.** Physical entities (creatures, the stew, doors) have their truth in their state. Conventional entities (Second Squad, ranks, ownership, tasks) exist because they are held: their truth is an authority's record (the duty ledger, the Commander's word). Tasks (§5) are conventional: an order exists because issuer and assignee recognise it.
- `presents`: the marks the entity shows (see "Observer-shaped description"). Defaults from kind and tags; disguises and illusions change `presents`, never the truth.
- `at`: where it is. A square (`"T3"`), a container entity (`"larder"`), or a holder (`"tobin"`). Items move by changing `at`, which is the whole of inventory at its simplest.
- `state`: kind-specific (`open`, `count`, `status`...).
- Hands are a limit on holders (two by default), not a separate inventory system.

### 2.2 Knowledge records (each mind's view)

`m.know[referentId] = { label, marks, events, state, at, t, how, from, sure, valence, links, grounds }`

Records are keyed by the mind's own **referent** (`hask:r17`, "the stranger in the grey tabard"), never by a truth id. Keying by entity would hand the mind an identification it never made (§2.4).

- `marks`: what this mind has noticed about the referent, each with its provenance.
- `events`: deeds attributed to it ("killed Dace"), each with its provenance.
- `grounds`: hidden; see §2.4.

- `how`: `saw | heard | told | inferred | assumed`. Only `saw` and `heard` come from perception; `told` from speech (with `from` and how sure it sounded, from the credibility system); `inferred` from engine deductions; `assumed` from defaults (a comrade is at their post).
- `t` is when it was *last confirmed*, which is different from when it was first learned.
- Tracks, door memory and claims migrate into this one shape. Their special behaviour (reachable regions for tracks, source/relay counting for claims) stays, as functions over the record.

### 2.3 Events

The existing `log.jsonl` stays the source of change. Each event gains `touches: [entityIds]` so perception and retrieval can find what it affected.

**Early foundation: individual observers and provenance.** Human-controlled characters
receive the same observer-specific perception and knowledge pipeline as model-controlled
characters; control determines who supplies decisions. World events need stable IDs,
observations cite `sourceEventIds`, and discrepancies cite both observations and the
expectations they conflict with. Narration can then link to those records instead of
guessing from adjacent log entries. A player's view must not inherit other observers'
private evidence or raw world-event payloads.

**Recognition / expectations experiment:** `node poc/recognition-demo.js` runs an isolated
prototype; `node poc/test-recognition.js` checks its contracts. See `poc/README.md` and
`poc/output/recognition-demo.md`. Models author structured conditional expectations;
the prototype validates them and checks observer evidence with supported, contradicted,
unresolved, and not-applicable outcomes. A concealed face is missing evidence, never
an unfamiliar face. Identity membership and personal friendship are separate records.
In-play expectations are character beliefs, distinct from established background.
Sensory delivery and investigative choices are scripted in this experiment, not yet
connected to live perception or automatic model decisions.

### 2.4 Referents: immediate and dynamic objects

An **entity** is the dynamic object, the ultimate truth. Minds never see entity ids. A **referent** is an immediate object: one mind's handle on something, holding what that mind has noticed and believes. Briefs, model decisions and the player's view all speak in referents.

**Grounds** are the hidden pointers from referents to entities. Two referents in different minds are coextensive when they share a ground. A referent's grounds can be:

- **one entity**: the normal case;
- **none**: a rumoured person who doesn't exist, the creature an illusion shows;
- **several**: conflation (two guards in identical masks treated as "the masked guard").

One entity can also sit under several referents in one mind: "Grub" and "the stranger" both grounded in Wren. That is Hesperus and Phosphorus, and it is the whole infiltration game.

Rules:

1. **Only recognition attaches an observation to a referent.** Perception delivers marks; recognition matches them to an existing referent or opens a new one. Grounds are never consulted to decide. A 1:1 fast path is allowed when the marks are unambiguous, provided recognition would have succeeded anyway.
2. **Merge and split are model-authored events with provenance.** "Hask concluded the stranger is Grub" links two referents; it never overwrites either, so it can be undone. If their grounds differ, Hask now holds a false belief, which is allowed. Discovery is the reverse: the engine reports that evidence has diverged within one referent, and the model splits it. Everything built on a split link is flagged for rethinking.
3. **Actions go through belief and land on truth.** "Attack r17" resolves to where Hask believes r17 is, and hits whatever is really there. If Wren moved, Hask swings at air.
4. **Grounds feed only the DM view and the trace.** `mind <id>` can show beliefs against truth; nothing grounded reaches a brief.
5. **Indistinguishable means identical.** Two worlds that deliver an observer the same evidence must produce the same brief, byte for byte. A listener who can't tell a disguised commander from the real one gets no hint in labels, keys, ordering or engine bookkeeping, and contradictory instructions from "the Commander" arrive as a real dilemma for the model. Differential tests enforce this: build both worlds, diff the briefs (`test-minds.js`, "indistinguishable").

Referents need readable labels: the best handle the mind has (a known name, then a role, then salient marks), coloured by valence. "The stranger" becomes "the dangerous stranger" when the mind attributes a hostile deed against an ally to it (§4); nobody writes the label by hand.

### 2.5 Groups, rosters and starting beliefs

Groups are conventional entities. Second Squad's roster is its state, the single source of truth for membership:

```
truth:  squad2 = { kind: group, roster: [hask, tobin, pell, dace], presents: "grey tabard, red cord" }

hask:   know.squad2 = { roster: [hask, pell, dace], complete: true, faces: true }
tobin:  know.squad2 = { roster: [hask, tobin, pell, dace] }
        know.self   = tobin
```

- **Self-membership is a query, not a stored fact.** "I am on Second Squad" means "my copy of its roster contains me". A mind's beliefs about itself and its groups can't disagree unless an encounter makes them disagree on purpose (he was discharged and doesn't know yet).
- **`complete` is knowing that you know.** It is a belief about one's own belief, and it is what turns an unfamiliar face in the squad's tabard into a contradiction instead of an open question.
- **Names and faces are separate.** A sergeant knows both; a clerk with the duty ledger knows every name and no faces. They react very differently to a stranger in a grey tabard.
- **Starting copies come from membership, at encounter start, then freeze.** Being on a roster gives a mind a copy of the group, at a fidelity set by role: a sergeant gets the full roster with faces and `complete`; a recruit gets their squad-mates' faces. After load, copies change only through perception and testimony; a creature spawned mid-fight is not instantly known to every sergeant.
- **Different assessments of one object are deliberate.** A copy that differs from the truth is written in the encounter as an override on that mind's belief, with a reason ("Hask's roster predates Tobin's transfer this morning"). Anything ascribed to an object is its default; anything relational lives with the observer. This is standard practice for encounter designers, LLM or human.
- **Groups nest.** The watch is a group whose roster is its squads; "I know everyone in the watch" and "I know my squad" are the same mechanism at different levels.

**Conflicting bases are reported, never resolved.** Group membership and personal acquaintance are separate reasons for regard; they reinforce when they agree. When they don't (a friend in an enemy tabard, a stranger in the squad's colours), the engine reports both bases and the conflict, and the model judges. A newly transferred Tobin and a disguised Wren look the same to a Hask who wasn't told: the tabard says squad2, the face matches nobody on a roster she believes complete. She has to ask. Tobin answers from his beliefs, Wren has to bluff, and credibility does the rest.

### 2.6 Testimony is a sense

Being told is a channel into the same recognition pipeline as seeing. Cross-mind coreference is recognition running on testimony; today's `m.claims` migrates into it.

1. **Speech carries descriptions, not ids.** When Pell speaks of "the assassin", the engine packages her referent's marks and events (red hair glimpsed, by the well at t3, killed Dace) and delivers them to the listener as evidence marked "told by Pell", weighted by credibility. The speaker's grounds travel hidden, so the DM can later see whether they were right.
2. **The listener's recognition matches the description like a sighting**: supported, contradicted or unresolved against each of their referents. The engine adds what follows necessarily: compatible times and places, or impossibility ("both were seen in the same round at T3 and K9: not the same person").
3. **The merge is the model's call** (§2.4, rule 2). After "Pell's assassin is my stranger", the marks pool: Hask knows the red hair (told by Pell), Pell learns the armour and sword (told by Hask).
4. **The link persists between minds.** Each mind's referent gains a link to the other's; next time either says "the stranger", it resolves directly. A shared name over linked referents is the seed of a conventional object.
5. **Mistakes spread too.** A wrong merge hands an innocent red-haired traveller a murder; provenance says exactly which conclusions rested on whose merge, and a later split flags them.

The party uses the same machinery: players comparing notes about "the cloaked figure" are merging referents, and the viewer shows their referents rather than the truth.

**Precipitation (later).** Referents with no grounds can still link across minds by shared names. A cluster of co-named, ungrounded referents that changes what people do (the larder ghost the guards avoid) is a conventional object; precipitation promotes such a cluster into a conventional entity. Nothing in §2.4-2.6 may close this off.

## 3. The expectation rule (one rule, many behaviours)

Every round, for every referent whose remembered `at` the mind can **see now**:

> If what is there doesn't match the referent as remembered, that is news. If nothing there matches it, it is gone, and that is news.

Matching is recognition (§2.4), so a disguised entity standing where it was last seen still counts as "gone" to a mind that can't recognise it.

This one deduction gives us, with no special code:

- **Absence:** "Tobin is not on the sand, where you last saw him (t3). You can see the sand now." (The bug that let the murder go unnoticed.)
- **Missing goods:** Hennick sees the apple barrel with 5 where he remembers 10.
- **Doors:** today's door rule becomes the general rule.
- **Task completion:** "The Commander is holding the stew" satisfies the stew task's condition (§5).

The engine states the deduction (`how: inferred`, citing the old record and the new sight). The model does the abduction: *why* is he gone, and should I worry?

Significance of a violation is scaled by salience (§4), so a stranger's empty stool is a shrug and a friend's empty post is alarming.

## 4. Salience and valence

Two numbers, **per mind, per record** (never global properties of objects):

- **Salience** (magnitude, 0-1): how hard it pulls attention.
- **Valence** (-1..+1): approach or avoid; appetite or threat.

The stew is +0.6 for hungry Tobin, ~0 for Dace, and for Hennick it is *his* stew: a negative pull whenever someone else is near it. A close friend grappled and dragged behind cover is salience ~1, valence strongly negative.

Computed by the engine from what minds already have:

| Source | Effect |
|---|---|
| Motivations ("Eat", "keep the larder honest") | sign and weight for matching entities |
| Relationships (trust, loyalty) | scales anything happening to that person |
| Surprise (expectation violations, §3) | spike that decays |
| Threat (hostile, uncanny, a comrade turning on a comrade) | large, negative |
| Tasks (§5) | the task and everything it links to |
| Habituation | repeated identical stimuli lose salience (the fifth creak of the larder door) |
| Recency | decay with time since last confirmed |

Valence is shown to the model ("you want this", "this is wrong", "this frightens you") but **never decides for it**. It is a lean, like temperament.

Side effect worth having: Tobin's slurp of the stew no longer needs an improvised DM save. The stew sits at the top of his attention with strong positive valence, and his model decides.

## 5. Tasks: orders as objects

An order becomes a task entity:

`{ kind: 'task', issuer, assignee, claimedBy, objective, done: <condition>, status: open|claimed|done|failed|superseded, t }`

- **Overhearing teaches about a task; only the assignee gets it.** Pell knowing that Tobin was sent for stew is a record about a task, not a task of his own. That's what stops three recruits pursuing one errand.
- **Completion is a deduction.** `done` is a condition on world state (`holder(stew) == cmdr`) the engine checks every round. Whoever sees it, or hears "done, sir", learns the task is closed. No more Pell guarding a bowl on the mantel ten rounds after the Commander ate.
- **Precedence is a rule, not a guess,** but only where the listener can tell the issuers apart: between different issuers, the highest-ranking one's newest order wins; ties break by recency. (The stale-order bug.)
- **A second order from the same apparent issuer doesn't cancel the first on its own.** Both stand, with where each came from ("you saw them say it" / "a voice to the east"), until the listener accepts one; accepting retires the one it displaced. Otherwise an impostor's order would silently replace the real one, and the model would never see the conflict (§2.4, rule 5). Built: v2 orders already work this way.
- **Judgment stays with models:** helping ("Tobin's struggling, I'll carry the bread"), taking over a botched job, ignoring a foolish order. A model may claim another's task; the engine records it and others can see it.
- Standing orders (v2) become tasks with no completion condition.

Conditions the engine can check need items to exist, so **tasks and inventory are built together.**

## 6. Attention and working memory

### 6.1 Candidates, focus, ranking

Every round, the engine assembles a mind's **candidate set**:

1. Everything perceived *now* (in view and attended, heard, felt).
2. **Focus:** active tasks, the current intention, messages addressed to them, open expectation violations.
3. **Neighbourhood:** records linked to anything in focus (the people, places and items a task or intention mentions), one or two links out.

Each candidate scores **salience × recency × link-closeness to focus**, with a bonus for things already in working memory (stickiness, so attention doesn't flicker between equals). This is the Generative Agents recipe (Park et al., 2023), with closeness measured through entity links instead of embeddings. Text similarity (the word overlap already used for claims) is the fallback for free-text records.

### 6.2 Bounded capacity, narrowed by arousal

Working memory has **K slots**. K shrinks as arousal (today's `alarm.intensity`) rises, following the cue-utilisation idea that stress narrows attention onto what is central:

- calm: ~7 slots; alert: ~4; combat: ~2-3 (tunable per mind).
- **Discipline decides what survives the squeeze.** Tasks carry a drill/habit weight (from obedience and training). A drilled order holds a reserved slot under stress; a rookie's order competes like anything else and can drop out. Training becomes a mechanic: rookies visibly fail in ways a veteran doesn't.
- **Perception still scans wide; working memory narrows.** Alert minds keep their all-round field of view (they still *notice* new threats), but a new threat must out-score the current focus to be *attended*.
- **Dropped is not forgotten.** Records stay in memory and return when arousal falls or something re-links to them ("wait, the door!").
- **Negative space is a trait.** Composed minds see a vague line ("other things are going on that you're not tracking"); panicked ones see nothing past their slots.

## 7. The brief as a contract

Fixed sections, always in this order, always the same line shapes:

```
NOW (perceived this round)
  - Dace Kettle, 5 ft east of you, in sight.
  - The sparring ring (E12:H15): in sight. Empty.
WORKED OUT (the engine's deductions; certain)
  - Tobin is NOT where you last saw him (the sand, t3). You can see the sand now.
  - Task "check on Tobin": open. Tobin's whereabouts: unknown since t3.
REMEMBERED (with age)
  - Tobin: last seen t3 on the sand, facing the Commander. 3 rounds ago.
TOLD (source, how sure they sounded)
  - The Commander (t5): "Go check on Tobin. He's looking under the weather." Sounded fairly sure.
YOUR TASKS
  - t12 from the Commander: check on Tobin. [open, yours]
ON YOUR MIND (valence)
  - Tobin: worry (-0.4).
```

Rules: negatives stated ("NOT in sight", "Empty"); every remembered line carries its age; told lines carry source and certainty; nothing appears in two sections; referent ids and labels are stable; no truth id ever appears.

## 8. Consolidation

Old observations roll up into lasting beliefs ("Tobin pinches food", "Dace oversells"). A cheap model runs a periodic **reflection** pass per mind, between scenes or every N rounds; the engine keeps **provenance** (which observations each belief rests on) so beliefs can be traced and revised. This is where emergent trust lives: "Dace said Tobin was standing; he wasn't" becomes part of what a mind knows about Dace, without a trust meter.

On-demand `recall <entity|place>` exists as an escape hatch for models, but focus-based prefetch (§6) should make it rare: a second call doubles latency.

## 9. Logging and inspection (a standing habit)

Every mind feature ships with its inspector. The question to answer is always: **did the model reason badly, or was it starved?**

- `mind <id> attention`: the full candidate set with scores (salience, valence, recency, closeness, stickiness), K and why, what made the cut, what was dropped and why.
- `mind <id> know [<entity>]`: records with `how`, `from`, `sure`, age; truth alongside (DM only).
- `mind <id> brief --explain`: each brief line annotated with the record or deduction it came from.
- Every round, a compact secret log line per mind: `[attn] dace K=4 kept: task t12, tobin(violation), cmdr, ring; dropped: larder door (0.12), pell (0.08)`.
- `minds` gains columns for K, top focus, and open violations.
- Tests assert on these structures, not on prose, except differential tests (§2.4, rule 5), which assert that two briefs are identical.

## 10. Build order

1. **Expectation rule + brief layout** (§3, §7), on today's tracks and doors. Fixes the absence failure immediately, and is the smallest proof of the paradigm.
2. **Entity layer and referent-keyed knowledge** (§2.1-2.4): `know` keyed by referent from the start, with hidden grounds and the 1:1 fast path; stable event ids and `touches`; items and tasks as the first new kinds; inventory (`take`, `give`, `drop`; hands); tasks with completion conditions and precedence (§5). Barracks food and gear become items. Tracks and doors become views over `know`.
3. **Recognition, groups and testimony** (§1 observer-shaped description, §2.5, §2.6): port the POC evaluator onto live perception; `presents` and default marks; group entities with roster copies and overrides; testimony into the matcher (claims migrate); merge and split links.
4. **Salience, valence and focus-based retrieval** (§4, §6.1), with the attention inspector (§9) built *first*.
5. **Bounded working memory** (§6.2), tuned with the inspector on the barracks and the goblin caves.
6. **Consolidation** (§8).

### Playtest fixes folded in

| Fix | Lands in |
|---|---|
| Comrades vanishing from view go unnoticed | step 1 |
| A comrade attacking a comrade doesn't lift the calm-lair ceiling | step 1 (threat source, §4) |
| Fallback follows a stale order | step 2 (task precedence) |
| Unstandable target resolved outside a wall during plan execution | step 1 (small, standalone) |
| Moving onto an ally's square should stop beside them | step 1 (small, standalone) |
| Drawing a real weapon isn't an event | step 2 (state change on a held item) |
| "Where the Commander was last seen" in briefs | step 1 (REMEMBERED section) |
| Errands outlive their completion | step 2 (task conditions) |

## 11. Open questions

- **K and the narrowing curve:** fixed tiers, or continuous in arousal? Per-mind override for temperament?
- **What counts as "attended" in perception:** everything in sight, or only what wins a slot? (Proposal: everything in sight is a *candidate*; only slot winners reach the brief.)
- **How much of the dropped set the DM narration may reveal** ("Dace doesn't seem to notice the door").
- **Reflection cadence and cost:** per scene, every N rounds, or when memory overflows?
- **Valence from the model:** may a model's decision update its own valences ("I'm not hungry any more")? Proposal: yes, through `beliefs`, validated like everything else.
- **Migration:** keep v2 encounters working throughout; tracks and claims become views over `know` rather than being rewritten at once.
- **Referent forgetting:** unattended referents with no links will pile up. Decay with salience (§6), or collect at consolidation (§8)?
- **Fast path boundary:** exactly when may recognition be skipped? Proposal: never for creatures whose `presents` differs from their default, or for any group-marked creature seen by a mind with a `complete` roster.
- **Told vs seen weight:** how much a told mark counts in matching, relative to a glimpse; whether it inherits the credibility scale directly.
- **Players merging referents:** in the viewer, by an explicit action ("that's the same one"), or by the DM from what they say?
