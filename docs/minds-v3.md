# NPC minds v3: entities, attention and memory (design)

Status: **design, not built.** Builds on `docs/stealth.md` (minds v2). Written after the Greyhold Barracks playtest (2026-10-10), whose failures it is meant to fix. Correct the shape here before code.

## 1. The paradigm

The engine is a set of **symworlds**: formal worlds (physics, perception, a universal psychology of habit, the social protocol of rank and orders) in which conclusions follow *deductively* from that world's axioms. "A glimpse warrants 0.5 certainty" is not a sloppy deduction; it is an axiom of the perception world. Models do what no symworld can: interpretation, hypothesis, choice, character. Induction and abduction between and beyond the worlds.

Two rules follow, and every playtest failure broke one of them:

1. **The engine never hands a model a deduction to make.** If something follows necessarily from what a mind knows, the engine states it in plain words. (Dace read "last seen on the sand" as "is on the sand" for four rounds while looking at the empty sand. DeepSeek reasons about "last seen" flawlessly when asked cleanly; the brief asked badly.)
2. **The engine never makes a judgment call wearing deterministic clothes.** If a rule has to guess intent, either the world's axioms are too vague or the question belongs to a model. (The nearest-standable-square guess sent Tobin outside the north wall; the fallback picked Hennick's stale order over the Commander's newer one.)

And one interface rule: **the brief is a contract.** Fixed sections, fixed formats, negatives stated outright. A model should never have to guess what a line means.

## 2. One layer for everything a mind can know about

Today the same idea is built five times, ad hoc:

| Thing | Truth | Per-mind record | News when |
|---|---|---|---|
| Doors | `walls[].open` | `m.doors` (state as last seen) | seen differently from memory |
| Creatures | `creatures` | `m.tracks` (last seen where/when/how clearly) | *missing: gone from where they were* |
| Stories | — | `m.claims` (text, sources, relays) | new source or new detail |
| Orders | — | `m.orders` (per-listener status) | *missing: done, superseded, abandoned* |
| Items | *missing* | *missing* | *missing: the apple count is short* |

v3 makes these one thing.

### 2.1 Entities (the truth)

`s.entities[id] = { id, kind, name, state, at, tags }` plus the existing creatures and walls, which keep their storage but are addressed the same way.

- `kind`: `creature | item | task | door | place | story`.
- `at`: where it is. A square (`"T3"`), a container entity (`"larder"`), or a holder (`"tobin"`). Items move by changing `at`, which is the whole of inventory at its simplest.
- `state`: kind-specific (`open`, `count`, `status`...).
- Hands are a limit on holders (two by default), not a separate inventory system.

### 2.2 Knowledge records (each mind's view)

`m.know[entityId] = { state, at, t, how, from, sure, valence, links }`

- `how`: `saw | heard | told | inferred | assumed`. Only `saw` and `heard` come from perception; `told` from speech (with `from` and how sure it sounded, from the credibility system); `inferred` from engine deductions; `assumed` from defaults (a comrade is at their post).
- `t` is when it was *last confirmed*, which is different from when it was first learned.
- Tracks, door memory and claims migrate into this one shape. Their special behaviour (reachable regions for tracks, source/relay counting for claims) stays, as functions over the record.

### 2.3 Events

The existing `log.jsonl` stays the source of change. Each event gains `touches: [entityIds]` so perception and retrieval can find what it affected.

## 3. The expectation rule (one rule, many behaviours)

Every round, for every record whose `at` the mind can **see now**:

> If the entity is not as remembered, that is news. If it is gone, that is news.

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
- **Precedence is a rule, not a guess:** newest order from the highest-ranking issuer wins; ties break by recency. (The stale-order bug.)
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

Rules: negatives stated ("NOT in sight", "Empty"); every remembered line carries its age; told lines carry source and certainty; nothing appears in two sections; ids are stable.

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
- Tests assert on these structures, not on prose.

## 10. Build order

1. **Expectation rule + brief layout** (§3, §7), on today's tracks and doors. Fixes the absence failure immediately, and is the smallest proof of the paradigm.
2. **Entity layer** (§2): items and tasks as the first new kinds; inventory (`take`, `give`, `drop`; hands); tasks with completion conditions and precedence (§5). Barracks food and gear become items.
3. **Salience, valence and focus-based retrieval** (§4, §6.1), with the attention inspector (§9) built *first*.
4. **Bounded working memory** (§6.2), tuned with the inspector on the barracks and the goblin caves.
5. **Consolidation** (§8).

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
