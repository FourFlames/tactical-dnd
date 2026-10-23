# Rust kernel: post-mortem and API priorities

Written at the end of the 2026-10-21 live session: goblin-warren-v2, round 16, Esquiggly as Noodle, Belugos-the-Mighty as Perchance, Brother Ash run by the DM. That session spent most of its budget on plumbing rather than on play. This doc records why, and what the planned Rust kernel should provide, **in priority order**.

**For coding agents:** build from the top down. P0 and P1 are the kernel. P2 is valuable later. "Examples, not features" is a list of things that happened at the table, for colour only. Don't pick tasks from it.

## State at session end

- **Save:** the game is in `saves/session-2026-10-21-end/` (state, log, seats, intents).
- **Uncommitted changes:** about 1,000 lines across 11 files, all passing `node --check`. They are:
  - `fog off|on` (engine.js, lib/core.js)
  - invisibility in mind sight (lib/minds.js `sightOf`)
  - relationship notes shown in briefs (lib/minds.js)
  - WASD camera panning, the oil puddle decal and the bucatini ring count (viewer/map3d.js)
  - minds moved to `deepseek/deepseek-v4.1-flash-1017` (minds.config.json)
- **Stopped midway:** the dynamic floor / wall / building agent (design in `docs/dynamic-floor.md`). `floor`, `wall add|remove` and `building` appear in the engine's help, and a load in a scratch folder works. Its tests in test.js were never run, so verify before relying on it.

## Where the time and tokens went (estimated ranking)

1. **The message loop.** Every player message cost 4 to 6 tool calls: the background `await` wakes the DM, the DM reads its output file, runs `intents`, `reply`, resolves, sends `reply --done`, then re-arms `await`. Every wake re-sent the whole conversation, and dozens of wakes were quiet End turn presses.
2. **Noisy engine output.** Nearly every command printed `[minds] will think…` lines and perception dumps, which had to be filtered out. Each CLI call also starts Node and reparses an ~840 KB `state.json`.
3. **Missing primitives,** worked around with respawns, rewinds or hand-tracking:
   - temp HP, both adding and removing it
   - renaming a creature
   - elevation changes
   - invisibility
   - extra turns
   - readied actions
   - area spells
   - concentration and repeat saves, and spell riders
   - noise loudness
   - cell-to-cell line of sight
   - ending combat
   - creatures with no mind being skipped silently by `auto`
4. **Mind setup.** Persona changes only go through a full `mind setup`, stale evidence can't be retracted, and debugging meant reading a 126-line brief.
5. **NPCs couldn't answer in the moment.** The DM wrote their replies by hand or forced a `think` (see P0: reactive minds).
6. **Live dev side-quests.** Five subagents.
7. **DM slips.**
   - the wrong teleport target
   - a readied trigger that couldn't fire
   - `move --dry`, which actually moved the creature
   - `think --all`
   - an English line sent before the language stand-in was set

## P0: the kernel (build these first)

### Transport and DM loop
- **Push event stream.** WebSocket or SSE, carrying typed JSON events: player intents, button actions, turn changes, mind speech and decisions, offers answered.
- **A `needs_dm` queue** with ids, `ack` and `resolve`. Several pending items arrive as one batch per wake. This replaces `await`/`intents` polling.
- **A context bundle on every wake:**
  - the speaker's sheet and turn state
  - what they pointed at, already resolved (range, line of sight, cover, path cost)
  - who is nearby
  - pending offers, concentration
  - the last few chronicle lines

  The goal is that a typical message needs no lookup calls.
- **One batched `act([...])` call.** It takes replies, commands, `say`, `describe` and condition changes; it validates everything, then commits atomically and returns every result. `dry_run` works on every command. Target: one tool call per routine message, two for a ruling (an instant acknowledgement, then the resolution).
- **Instant acknowledgement from the server** ("DM is reading…") the moment a message arrives.
- **Questions to players become offers with buttons,** so the player's answer comes back structured.
- **Plain mechanical text skips the DM.** Simple patterns ("move to M14", "attack gob3 with Ray of Frost") are parsed server-side.
- **Output levels:** compact by default, with verbose or debug per subsystem or per mind.
- **Latency targets:** acknowledgement under 5 s, routine resolution under 15 s, a ruling with a roll under 30 s.

### State
- **Event-sourced.** Commands produce events and state is a fold over them. The RNG is seeded and deterministic, and rewind and branching are cheap.
- **Projections:** the DM view, the player view (with fog modes), and a belief view per NPC.

### Creatures
- **`creature.patch` for any field:**
  - hp, temp_hp, max_hp
  - name, size, side, controller
  - speeds (walk, fly, swim, climb) and senses (darkvision, blindsight, truesight)
  - languages, resistances, attacks, resources, notes
- **Conditions** with durations, end-of-turn save rules, and a source link (used for concentration).

### Turns
- Initiative, plus starting and ending combat.
- **An explicit policy for each creature type** (player, party agent, minded NPC, DM-run NPC). No creature's turn is skipped silently.

### Reactive minds (NPCs answer in the moment)
Today a minded NPC thinks only on its turn or on `tick`. When a player spoke to one, the DM had to force a `think` or write the reply himself. Two examples: Snikka's answer to the three-count, and Dribble's surrender. The fix:

- **Reaction triggers.** A short reaction pass fires whenever a minded NPC is addressed directly, or hears something urgent: a threat, its name, a surrender demand, an ally falling.
- **The reaction pass is small.** It returns speech, an alarm change, belief updates, and optionally a reaction (an opportunity attack, or a readied action). It never makes full turn moves. Keep `max_tokens` low so it returns in about 1 to 3 s.
- **Several NPCs react in parallel,** and are merged by distance or salience so the nearest speaks first.
- **The player's action holds** until reactions are in, with a short timeout (about 5 s; past that, a fallback line). The chronicle shows the reply as part of the same beat.
- **Coalesce and rate-limit.** One reaction per NPC per beat, so a crowd doesn't multiply the cost.
- **The full deliberation still runs on the NPC's turn,** pre-thought in the background as soon as news arrives, so its turn rarely waits on a model call.

This trades a few seconds of latency for NPCs that answer for themselves, which is the right trade.

## P1: rules coverage (needed for normal play)

- **Areas:** sphere, cone, cube, line and cylinder, aimed at a point, a creature or the caster. Saves, half damage, resistances and immunities.
- **Data-driven `cast <spell> [level] [targets|point]`:** slots, scrolls with their DC and casting check, metamagic, the wild surge hook, concentration ownership, and the effects a broken concentration ends.
- **Automatic bookkeeping:**
  - concentration saves when damaged
  - end-of-turn repeat saves
  - riders expiring
  - morale on the boss's death
- **Readied actions** with structured triggers ("an enemy within 15 ft", "creature X moves").
- **Movement:** flying and swimming, and teleport that doesn't provoke opportunity attacks or leak position to perception.
- **The map at runtime:** floor height, glyph and surface swaps, walls, doors and windows. Line of sight, range and look between any two cells, with height included.
- **Perception:** light, cover and stealth; invisibility, truesight and blindsight; noise loudness that scales with how loud it is (an explosion carries warren-wide); language-aware hearing.
- **Minds:** edit persona, motivations, relationships and rank in place; retract or override evidence; per-mind model selection; cost accounting; a brief preview and diff.

## P2: valuable later

- **Persistent zones** that spread (fire, fog, webs), with start-of-turn and on-enter triggers.
- **Objects with HP and tags,** and chain reactions (explosive barrels, powder kegs).
- **Extra turns and turn insertion** (Action Surge, haste-like effects).
- **Speech in other languages, rendered per listener:** the stand-in language for everyone, plus a translation only for those who understand it (Draconic = Italian, Sylvan = Welsh, Celestial = Classical poetic Chinese).
- **DM grants as persistent modifiers** (advantage, a fixed d20 roll, speed overrides) instead of notes the DM has to remember.
- **Per-player permissions** for what their buttons may do without DM review.
- **The builder:** seats and links, builder suggestions and homebrew review, as they work today.

## Drafter evaluation (experiment, not a feature)

Question: can a cheaper or faster model draft the DM's response to typed player input often enough to help?

- **Shadow mode.** For every typed message, a drafter (DeepSeek, Sonnet or Haiku) gets the same context bundle and proposes a command list, a reply, and a DC if the message needs a ruling. Nobody sees the draft. It's logged next to what the DM actually did.
- **Scoring,** by category (moves, attacks and spells, talking to NPCs, creative rulings, meta requests):
  - same commands
  - same targets
  - a DC within ±2
  - latency

  Score against the DM's final outcome, not the DM's first move.
- **A test set already exists.** The 2026-10-21 `intents.jsonl` has about 60 typed messages, each with a message id, and `log.jsonl` has the commands and replies for each. Replay them through each drafter without needing the kernel.
- **Outcomes:**
  - where agreement is high (likely moves and attacks), the draft rides along in the bundle and the DM approves it with one call
  - where it's low (likely rulings), ignore the draft
  - if nothing helps, scrap it

## Examples, not features (for colour only; don't build these specifically)

These happened at the table and show the range of things players will try. The general systems above should make them possible. None of them is a feature to build on its own:

- pulling a Planetar, a surrendered goblin, or a whole building out of a bag of holding
- reading a Scroll of Time Stop and walking past frozen goblins
- a player asking to always roll 20s, move 100 ft, or be permanently invisible
- tickling a goblin into surrender, or licking an angel's wing
- a paranoid shaman given 100 temp HP and a DeepSeek-invented grudge against everyone
- speaking "Draconic" (Italian) to a gold wyrmling and offering it a sandwich
