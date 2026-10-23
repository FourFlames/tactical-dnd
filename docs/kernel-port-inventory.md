# Kernel port inventory: what the old engine does, and what to bring over

Surveyed 2026-10-23 by four read-only agents over the Node engine and viewer in the main checkout
(including its uncommitted work). Appendices A–D are their full reports; everything above them is the
merged view and the decisions it needs. Mark this file up directly: `keep` / `change` / `drop` / `later`
next to any line.

## The short version

- **The real mechanics are small.** About 600 lines carry combat: attack planning (`lib/core.js:536`),
  attacks and damage (`engine.js:467`, `engine.js:61`), saves, checks and rulings, initiative and
  turns, opportunity-attack detection (`lib/grid.js:536`), falls, death saves. They port nearly as they
  are, as pure functions over state.
- **Most "rules" were prose.** Class features, most spells and most condition effects lived in `notes`
  text that the DM applied with generic commands (`condition`, `spend`, `use`, `damage --save`,
  `ruling`). The character builder (`lib/rules.js`, 1.6k lines) is data tables whose output is already
  the engine's stat block: port it as data, later.
- **Space was one fixed grid per encounter.** A–Z columns, one height per square, no levels, no
  transitions; `goblin-warren-v2` is three maps merged by hand. The algorithms (3D distance, line of
  sight and cover with wall heights, edge walls and doors, climb/jump/fall, wall-muffled sound) are
  good specifications; the data model is what has to change.
- **Minds got the principles right:** the model never sees truth, decisions are validated field by
  field, a deterministic fallback keeps the world moving, the engine states its deductions in words.
  The perception half maps onto marks, readings and traces. The motivation half (alarm, plans, orders,
  credibility, temperament, morale) has no home in the kernel design yet.
- **The UI worth keeping is the 2D table furniture:** the turn HUD with pips and Dash/Disengage/Dodge/
  End turn, route preview with the provoke warning, offer dialogs, inspect cards, chronicle, pings and
  chat. The 3D map, action wheel and orbs were experimental: later.

## Patterns that cut across every area

These show up in all four reports, and the kernel already answers most of them:

| Old pattern | Where it hurt | Kernel answer |
|---|---|---|
| `side` decides hostility, death saves, morale, "combat over", OA queueing | everywhere (`grid.js:216`) | stance per observer; "player character" becomes a kind/mark, not a side |
| `Math.random`, rolls flattened into log strings | no replay, no structured dice for the UI | dice seeded per step; rolls are events with faces |
| State mutated in place; side tables (`tagOverrides`, `s.undo`, OA teleport-and-restore) | rewind as file copies, map edits invisible to history | everything is an event; map changes are events too |
| Free-text tags and conditions tested with `.includes` across files | 25+ tag strings, 6 different "helpless" lists | typed terrain properties and conditions as data (a codex table) |
| String ids in commands and log prose | names baked into the log | handles per observer; events rendered per observer |
| Whole-map recomputation (visibility, light) | 1 s Hide previews until cached | chunk-bounded, cached per observer and version |
| Mind edits only through a full `setup`; 100-line briefs | slow, opaque | umwelt rendered on demand with fixed sections; live edits are steps |

## Decisions for you

Each is a fork where the reports disagree with each other or with the current design, or where your
answer changes the first cards.

1. **Space model.** One sparse chunked world grid with stacked surfaces per square, regions joined by
   portals, or the hybrid (local 5 ft grids in their own frames, stitched by portals), all behind a
   narrow `Space` interface (neighbours and step cost, sight line and cover, surface at, place of).
   My recommendation: the hybrid, starting with one static frame. → see "Space" below.
2. **Levels.** Stacked floors in a square (floor, ceiling, void) from day one in the data, even if the
   first map uses one? Recommendation: yes in the data shape, no in the first algorithms.
3. **Creature footprint.** One square for everyone (old), or sizes occupy squares now? Recommendation:
   store size, keep one-square movement until a Large creature is on a map.
4. **Is a move one step or several?** The old `move` rolled Athletics, falls and monster OAs inside one
   command, so HP could drop mid-path. Recommendation: one step for the declared move, with the
   interruptions (OA offers) splitting it into a follow-up step at the point they happen.
5. **Conditions and features as data.** A codex table of condition → modifiers (advantage, auto-fail
   saves, speed 0, can't react) with source links for concentration. Recommendation: yes; class
   features stay prose for the DM except the few with numbers (extra attacks, sneak dice, crit range).
6. **Rules as data or code?** Spells and the builder's tables as JSON codex entries; the math in Rust.
   Recommendation: yes, and consume the old builder's `derive().creature` output as JSON to get
   characters in early.
7. **Library commands (`ext/`).** Keep the propose → JD review → approve workflow; implement as
   scripts that expand into base commands (shove = contested check + place + condition). Later WASM or
   a small script language if needed.
8. **Minds' missing half.** Where do alarm, plans, orders, credibility and temperament live? Options:
   extend the kernel design now, or defer until after the skirmish slice. Recommendation: defer, but
   reserve the shape: a mind has state beyond its traces (arousal, intentions), and orders are entities.
9. **Out-of-combat time.** The old `tick` (one round of every NPC's plan) vs the kernel's `wait` with a
   game clock. Recommendation: `wait` drives ticks; NPC plans run per tick once minds exist.

## A combined first playable slice

Merged from the four reports' minimal slices, in build order. Each line is roughly a card.

1. **Save rooms to disk** (timeline + inbox), so a game survives a restart.
2. **Space v1** behind the `Space` interface: one static frame; per-square floor height; terrain
   properties as typed data (blocks move/sight, difficult, cover, climbable, water); edge walls and
   doors as events; pathing with walls, climb cost and dash; 3D distance; line of sight and cover with
   the old eye/mid/head vantage scheme (old `test.js` cases as the oracle).
3. **Stat blocks and dice:** the old creature shape (hp/max/temp, ac, speed, stats, saves, skills,
   attacks, resources, resist/immune/vuln); seeded rolls as events; `check`, `save`, and `ruling` with
   stakes set before the roll.
4. **Combat:** initiative, turns and the turn tracker (move, action, bonus, reaction), dash/disengage/
   dodge, attack (attack planning ported), damage with save-for-half, heal and temp HP, 0 HP and death
   saves by kind, `use`/`regain`/`spend`, end combat. Conditions: prone, unconscious, restrained,
   paralyzed, stunned, incapacitated, dodging, frightened, poisoned, with durations.
5. **Opportunity attacks and offers:** provoke detection along the path; an offer to the reactor's
   controller with an expiry; resolved at the departure point. Offers also carry DM terms (Do it /
   Never mind with a skill and DC).
6. **The table UI on the SVG page:** seat sign-in codes and DM-only gating; turn HUD with pips and
   buttons; route preview with cost, provokes and dash fallback; offers dialog; inspect card (`look`);
   chronicle with `say` lines; dice toasts; initiative bar; quiet/loud on inbox items.

Deferred, with a home: concentration automation, areas and `cast`, summoned entities, morale and
rout (with minds), jumps/vaults, fog persistence, light and noise (with perception step 3), the
builder, 3D, the wheel.

## Space: the options in one place

The user wants seamless space: no hard edges between maps, rooms or floors. The old model's limits
(Appendix B §4) are the list of things to design out: fixed bounds, one height per square, no
transitions, runtime edits in side tables, whole-map visibility, straight-line sound.

**A. One sparse world grid in chunks.** Global coordinates cut into chunks stored only where something
exists; rooms are labelled regions. Each square holds a short list of standing surfaces (floor,
balcony, bridge over a chasm), walls sit on edges. Simple and fast; line of sight is a 3D grid walk.
Weak at moving geometry: a swinging bridge means rewriting squares.

**B. Regions joined by portals** (Doom/Build sectors, navmeshes). Space is a graph of regions with
their own floor heights, joined by doorways, stair ends and ledge lips. Seamless by construction;
moving regions carry their own transform; sound and smell travel along portals (around corners,
through open doors). More machinery: sight has to be clipped through portals, and tactical squares
have to be laid over each region.

**C. Hybrid: local grids in frames, stitched by portals.** Each area is a 5 ft grid with a position and
orientation in the world; most frames never move, a ship or bridge is a frame that does. Portals join
neighbouring grids; pathing, sight and sound cross them. 5e's squares from A, B's moving pieces and
topological sound.

**Separately: places.** A tree of named regions (shrine ⊃ nave ⊃ altar) over any geometry, for
narration, light areas, indoor/outdoor, sound dampening, patrol anchors and "you hear something in the
kitchen". Data of its own, not baked into the map.

**Recommendation:** C behind a narrow interface; positions become (frame, square, level). The first
implementation is a single static frame, which is today's crossroads map, so nothing waits on the
hard parts. Make terrain changes events from the start, and keep visibility chunk-bounded and cached.

---


# Appendix A: Port survey: rules and combat mechanics (old Node engine -> Rust kernel)


All paths are in `C:\Users\Temho\tactical-dnd`. Line numbers are from the working tree (includes uncommitted edits). Read-only survey; nothing was run.

### 1. Summary

1. The combat core is small and legible: `attackPlan` (pre-dice decisions: reach/range, LOS, cover, advantage folding, sneak) + the `attack` command (d20, crit, damage, `applyDamage`) in `lib/core.js:536` and `engine.js:467`. About 400 lines cover most of a skirmish.
2. Almost everything else is **hand-bookkept through generic primitives**: `condition add`, `spend`, `use`, `regain`, `damage --save`, `ruling`. Class features, spells and most 5e conditions are prose in `notes`, and the DM (an LLM) applies them. This is the real "rules engine"; the engine mostly validates and logs.
3. Only a handful of conditions have mechanical effect in code (prone, restrained/paralyzed/stunned/unconscious/blinded, dodging, incapacitated, surrendered, hidden). Frightened, poisoned, charmed, invisible, grappled, deafened, exhaustion, and concentration riders are not implemented.
4. The character builder (`lib/rules.js` `derive()`) is the largest and most solid piece: all 12 classes L1-20, species, feats, gear, curated spells to L3, homebrew power rating (`lib/power.js`). Its output `creature` is exactly the engine's stat block. It is pure data and portable, but 1,569 lines of JS tables.
5. State is a single mutable JSON blob (`state.json`) edited in place; rewind is "copy the whole state file before each command" (50 kept). Dice are `Math.random()`. The post-mortem (`docs/rust-kernel-api.md`) lists the missing primitives: temp HP editing, patch for any field, areas, cast, concentration/repeat saves, readied actions, extra turns, persistent zones.

### 2. Tables

Legend: Port = as-is / rethink / drop. "Fit" uses kernel vocabulary (command -> events -> fold; marks; stance; steps).

#### 2a. Attacks and damage

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| attackPlan | Pre-roll decision: attack lookup by substring, reach/range, LOS, long range, ranged-in-melee, prone/helpless/dodging/hidden/unseen adv-dis, cover AC bonus, sneak eligibility, crit-19 | `lib/core.js:536-583` | `creature.attacks[]`, `conditions[]`, `hideState`, `s.turn[id].sneak` | solid; 5e-correct for core cases. Adv/dis folding via `fold()` (adv+dis cancel) is right | as-is (logic), rewrite in Rust | pure fn over folded state -> `AttackPlan{mode, notes, ac, sneak}`; a "reading" of the situation, also usable for dry-run previews |
| attack command | d20 (adv/dis), nat1 miss/nat20 crit, crit doubles dice, auto-crit vs paralyzed/unconscious within 5 ft, spends action/bonus/reaction, Extra Attack counter, hides revealed on attack | `engine.js:467-514` | attack `{name,bonus,damage:"1d8+3",type,reach|range:[n,l],finesse,critRange,as,cast,spell}` | solid; `--extra`, `--bonus`, `--sneak` flags carry class riders by hand | as-is | command `Attack` -> events `AttackRolled{nat,total,ac,hit,crit}`, `DamageDealt`, `ResourceSpent`; dice from per-step seed |
| Damage application | Resist (floor half), immune, vulnerable; temp HP soak; 0 HP: party -> unconscious + deathSaves, others "go down"; auto concentration CON save | `engine.js:61-84` | `creature.resist/immune/vulnerable[]`, `tempHp`, `deathSaves{ok,fail}`, `concentrating{spell}` | solid, but resist/immune apply to the whole hit (no per-damage-type split on multi-type); `side==='party'` decides death-saves-vs-dead | rethink | event `HpChanged`; "player-character-ness" must come from a mark/kind, not side |
| damage command (+save) | Raw damage, optional `--save dex --dc N --half` | `engine.js:516-529` | dice string, type | solid; this is the DM's tool for every save spell | as-is | command `Damage{target, expr, type, save?}`; area version is P1 in post-mortem |
| heal | Heals, clears unconscious + deathSaves. No temp HP, no max-HP change | `engine.js:531` | `hp,maxHp` | half-built (post-mortem: temp HP add/remove was a top workaround) | rethink | `Heal`, `GrantTempHp`; needs `Patch` |
| dice | `roll("2d6+3",{crit})`, `d20(mode)` with adv/dis detail strings | `lib/core.js:586-615` | `Math.random` | solid but **unseeded**, returns display strings | rethink | seeded per step; return structured rolls (faces) not text |
| fall | 1d6/10 ft, max 20d6, prone; water: half, quarter on good Athletics/Acrobatics | `engine.js:86-105, 367` | tags `water`, elevation | solid, nice | as-is | event `Fell{feet}` -> damage + prone |
| Sneak Attack | Eligibility computed in plan; dice string from `features` text regex | `lib/core.js:497-505, 565-575` | `features[]` text "Sneak Attack +2d6" | hacky (regex over prose) | rethink | typed class-feature mark with `dice` field |
| Spiritual Weapon | Spectral token that attacks from its own square, moves 20 ft, bonus action, concentration | `lib/effects.js` whole, `engine.js:1148` | `s.effects[]{id,spell,owner,since,rounds,conc,pos}` | half-built, single hard-coded spell (`SPECTRAL` table) | rethink | a summoned entity with owner + duration; generalise or drop |

#### 2b. Saves, checks, rulings

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| saveRoll | d20 + save bonus (`saves[k]` else ability mod); auto-fail STR/DEX when paralyzed/stunned/unconscious | `engine.js:548-557` | `saves{}`, `stats{}` | solid | as-is | `Save` command/event; condition-driven auto-fail should be data |
| check | Skill/ability roll vs optional DC; no DC = report total for DM to judge | `engine.js:565` | `skills{}` (total bonus) else ability mod; SKILLS map line 16 | solid; skills stored as final totals, not proficiency | as-is | maps to existing "mark reading trees"/checks in kernel; note passive = 10 + skill |
| ruling | Sets stakes first: skill, DC, `--about`, `--success`, `--fail`, then rolls and prints. Outcome applied by hand afterwards | `engine.js:576` | text fields | solid *as a pattern*; outcome application is manual (see Traps) | as-is (pattern) | step with `ruling{terms}` + `RollResolved`; keep stakes-before-roll as a first-class event |
| offer | Pushes a Do it / Never mind dialog to a player; with `--skill` the server rolls the ruling on yes | `engine.js:1364`, answer in `server.js` | intent entry `{offer, creature, text, ruling?}` | solid, a core DM loop piece | as-is (concept) | kernel already has "questions to players become offers"; keep structured answer |
| Contested check (shove) | Athletics vs best of Athletics/Acrobatics, push 5 ft/prone, ledge falls | `ext/shove.js` | -- | solid example | as-is | library command (see 2h) |
| deathsave | d20: 20 -> 1 HP, 1 -> two fails, >=10 ok; 3 fails dead, 3 ok stable | `engine.js:1194` | `deathSaves` | solid; `dead`/`stable` are just conditions, nothing consumes them | as-is | event `DeathSave` |

#### 2c. HP, conditions, durations

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| Conditions | `{name, rounds?}`; `condition add/remove`; `addCond` replaces same name | `engine.js:107, 590` | `conditions:[{name,rounds}]` | hacky: free-text names; only some consulted | rethink | typed Condition marks with source link, duration, end-of-turn save rule (post-mortem P0) |
| Duration tick | At the start of the afflicted creature's turn, `rounds--`, expire at 0 | `engine.js:~1007-1013` (advanceTurn) | `rounds` | solid, but ticks at *owner-of-condition's* turn, not caster's; `dodging` = 1 round | rethink | duration anchored to a source+turn boundary |
| Mechanically live conditions | prone (adv melee/dis ranged, half speed), restrained/paralyzed/stunned/unconscious/blinded (adv to hit), grappled/restrained/etc. block move, incapacitated blocks OA/react, dodging, surrendered, hidden/unseen, asleep (AI idle) | `core.js:536-583`, `engine.js:188-`, `grid.js:536` | -- | half-built. Missing: frightened, poisoned, charmed, deafened, invisible (only in minds `sightOf`), exhaustion, helpless auto-crit only for paralyzed/unconscious (not stunned etc.) | rethink | table of condition -> modifiers (data), not scattered `hasCond` lists |
| Concentration | One spell at a time; damage forces CON save DC max(10, dmg/2) cap 30; 0 HP drops it; new one ends old | `lib/effects.js:46-60`, `engine.js:61-80, 1140` | `concentrating{spell,since}`, `effects[].conc` | half-built; spell riders still hand-ended | rethink | condition with source link; ending it removes all linked marks (post-mortem P0/P1) |
| Temp HP | Soaks damage first | `engine.js:67` | `tempHp` | half-built: no command to add/remove (listed first in post-mortem's missing primitives) | rethink | via generic `Patch`/`GrantTempHp` |
| Game clock | `s.clock` counts 6-s rounds for spell durations; combat rounds and exploration `tick` both advance it | `lib/effects.js:10-14, 46` | `clock`, `effects[].since/rounds` | solid idea | as-is | kernel already has a game clock |
| Death/dying | party at 0 HP: unconscious + deathSaves; others just `hp 0` (removed from order on advance) | `engine.js:73-76, 1000` | -- | hacky: depends on `side==='party'` | rethink | mark "player character" or dying policy per entity |

#### 2d. Initiative, turns, action economy

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| initiative | d20 + `initBonus` (else DEX mod) for every positioned creature (downed monsters skipped); sort by init then DEX; round 1 | `engine.js:944` | `init`, `turnOrder[]`, `round`, `turnIdx` | solid; no ties/advantage/surprise; dead monsters excluded | as-is | `StartCombat` event with seeded rolls; order is derived state |
| next / advanceTurn | Skips dead monsters; removes fled; flips round, ticks effects, resets `turn` tracker and `reactionUsed`, expires conditions, flags burning; refuses to end a seated player's turn (`--force`) | `engine.js:982-1018, 1071` | `turn{id:{used,dash,disengage,action,bonus,attacks,sneak}}` | solid (heavily playtested), but 100-iteration guard + OA pause (`awaitingOAAdvance`) is intricate | rethink | event `TurnAdvanced`; "who may end a turn" is a policy |
| turn tracker | Per creature: movement used, dash, disengage, action, bonus, attacks made; `reactionUsed` lives on the creature | `engine.js:53, core.js:507` | see section 3 | solid | as-is (shape) | derived from events since turn start; reaction refreshes on own turn |
| dash / disengage / dodge | Flags in tracker; dodge = 1-round condition; `--as bonus` for Cunning Action | `engine.js:396-407` | -- | solid | as-is | commands -> events `Dashed`, `Disengaged`, `Dodging` |
| use / regain / spend | Mark action/bonus/reaction spent or returned; decrement named resource (slots2, secondWind, javelins...) | `engine.js:408-435` | `resources{}` numbers | solid, simple and flexible (it *is* the class-feature engine) | as-is | `SpendResource` / `Refresh` events |
| turn <id> (repair) | Force whose turn it is | `engine.js:1093` | -- | solid; born of a DM slip | drop (becomes surgery/rewind) | kernel timeline surgery covers it |
| undo | Revert this turn's last move if no dice rolled and no other action; restores hiding unless noticed | `engine.js:436` | `s.undo` snapshot | hacky special case | drop (use rewind/step revert) | timeline |
| combatOver | No hostile able to fight (down, fled, surrendered, morale) or party down | `engine.js:1022` | side/morale | hacky (side-based) | rethink | derived from stance; "end combat" explicit command is a listed gap |
| Missing | readied actions, extra turns/turn insertion, surprise, lair/legendary actions, bonus-action spell rule | post-mortem P1/P2 | -- | missing | -- | -- |

#### 2e. Opportunity attacks and movement-coupled rules

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| provokeDetail | Hostiles whose reach (max melee reach) is left along the walked path, in 3D; skips incapacitated/reaction-used/surrendered; disengage = none; hidden mover only provokes those who see it | `lib/grid.js:536-557` | path cells, `attacks[].reach`, `hideState` | solid | as-is | pure function over path; evaluated during `Move` resolution |
| pending OA queue | `queueOAs` records `{id,by,target,from,z,round,turnIdx}`; player reactors get an offer; DM ones lapse after 2 turns; `oa <id>` resolves vs target as it stood at departure cell | `engine.js:298-366, 336` | `s.pendingOA[]` | half-built; the lapse rule and `awaitingOAAdvance` pause were patches (playtest notes 16/17). Auto-rolled for monsters hitting party members | rethink | a reaction offer event with explicit expiry; resolve at the *step* where it was provoked |
| Move rules touching combat | Speed x2 dash, half when prone, difficult terrain double, can't move when grappled/restrained/paralyzed/stunned/unconscious, jump/vault/climb Athletics checks, forced `--force` | `engine.js:188-292` | `speed`, terrain tags | solid but mixed with movement (belongs to the movement area) | rethink | movement owner is another survey; only the *rules hooks* matter here |
| place / fall | Teleport/forced move without cost or OAs | `engine.js:382` | -- | solid | as-is | event `Displaced` |

#### 2f. Resources, spells, class features

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| resources | Free dict: numeric counters (`slots1..9`, `secondWind`, `actionSurge`, `rage`, `javelins`, `pactSlots`) | creature field; `rules.js:1333-1345` | `{key: number}` (some objects) | solid but untyped; no rest recovery command exists | rethink | typed counters with refresh rule (short/long/dawn) |
| Class features | Level-gated text list `[lvl, name, desc|fn(ctx)]` per class/subclass; no mechanics except a regex pass for Sneak Attack / Cunning Action / Rage / Extra Attack / Action Surge / Second Wind strings | `lib/rules.js:289-764`, `core.js:497` | prose | **by design prose** -> DM LLM applies. Second Wind is `heal rook 1d10+3` + manual decrement (CLAUDE.md) | drop (as engine); keep as DM reference text | DM reads class feature descriptions; only a few become typed marks (extra attack count, sneak dice, crit range) |
| Spell list | Curated L0-3 `SP(id,name,level,classes,desc,mech)`; `mech` = `{atk|save,dmg,type,range,scale,mod,beams,heal,bonus}` | `lib/rules.js:91-227` | spell record | solid for ~100 spells; mech only for damage/heal cantrips | as-is (data) | JSON codex for spells; extend with area/condition/duration fields |
| Spell attacks -> attacks[] | Builder emits attack-roll spells as `attacks` entries with `spell:true`, bonus = prof+castMod, scaled dice; `as:'bonus', cast:N` spends a slot | `rules.js:1241-1262` | -- | solid | as-is | same Attack command |
| Save spells | Not engine-modelled; builder writes a note with the exact `damage ... --save ... --dc` command; DM runs it | `rules.js:1241+`, CLAUDE.md table | note text | half-built (post-mortem: `cast <spell>` with areas is P1) | rethink | data-driven `Cast{spell, level, targets|point}` |
| Cast / slots | Only for attacks with `cast:N`: finds lowest slot >= N, decrements | `engine.js:~480-490` | `resources.slotsN` | hacky, one code path | rethink | `Cast` command |
| Effects registry | Duration + owner + position tokens (see Spiritual Weapon) | `lib/effects.js` | `s.effects[]` | half-built | rethink | marks with source link |

#### 2g. Morale, NPC-facing combat bits

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| morale | `morale all --dc 10`: WIS save for each hostile mind; failures set `m.morale='rout'`; surrendered = condition `surrendered`; routed minds flee, cornered ones surrender | `engine.js:1171`, `lib/minds.js:1972-2000` | `s.minds[id].morale{state,t}`, `fled` | solid, playtest-driven (note 10) | rethink | mind layer + a save; belongs with minds, fit as a DM-called command that sets an intention |
| flee | `fled` flag; removed at end of its turn | `engine.js:995` | -- | solid | rethink | `Removed{reason}` event |
| hidden/stealth in attacks | Attacker hidden -> adv + revealed; target `hideState` -> dis | `core.js:556-560` | `hidden`, `hideState` | depends on stealth design | rethink | kernel perception already owns this |

#### 2h. Characters, builder, rewind, library

| Feature | What it does | Where | Data | State | Port | Fit |
|---|---|---|---|---|---|---|
| derive(build) | Choices -> sheet + engine `creature` (hp, ac, speed, initBonus, stats, saves, skills totals, attacks, resources, features, notes, attacksPerAction, resist/immune, armor look, noisy) | `lib/rules.js:911-1411` | build `{species,class,subclass,level,background,abilities,picks,gear,homebrew}` | solid, big, tested (`test.js`); mixes display strings and engine data | as-is (the data tables and math); rewrite or keep JS and emit JSON codex | codex `class`, `species`, `feat` records + a pure `build -> StatBlock` |
| Homebrew power | "Feat points" pricing vocabulary, benchmarks vs official content, creep allowance, DM/JD approval via fingerprint | `lib/power.js` (256), `rules.js:894-910` | `homebrew[]{effects[],status,approvedSig}` | solid, niche; not combat-critical | drop for MVP | later |
| Persistence | `characters/<id>.json` build + suggestions; `char <id> spawn <cell>` copies `creature` into the encounter, joins turn order, seats owner | `lib/chars.js`, `engine.js:1484-1564` | -- | solid | rethink | kernel spawn from codex stat block |
| Suggestions | DM sends patch to a build the player accepts/declines | `engine.js:1565`, `chars.js:191` | `{path: value}` patch | solid, UX piece | drop for MVP | -- |
| rewind | Before each state-changing command, write full state + log length to `snapshots/N.json` (keep 50); rewind restores, greys later log lines | `engine.js:2134-2185` | -- | solid but crude (whole-file copy, 840 KB state) | drop | kernel timeline is strictly better (step revert, surgery) |
| ext library | `ext/<name>.js` exports `{usage, description, origin, run(s,args,api)}`; engine injects an API of `C, who, fail, applyDamage, fallOn, addCond, saveRoll, abilityBonus, turnState...`; `pending/` for proposals reviewed by JD; DM can't move into `ext/` without player OK | `engine.js:2117, 2200-2210`; `ext/shove.js`, `ext/inv.js` | -- | solid pattern, only two commands (shove, inventory) | rethink | kernel "library command" = data/script that expands to base commands; or WASM/script. Keep the proposal -> review -> approve workflow |
| help/info/status | Readouts | `engine.js:170, 1112` | -- | solid | as-is as DM projections | DM view bundle |

### 3. Data structures worth knowing

Creature stat block (encounter file and `derive().creature` use the same shape):

```json
{"name":"Rook","side":"party","controller":"player","pos":"H8","hp":28,"ac":18,"speed":30,"initBonus":1,
 "stats":{"str":16,"dex":12,"con":14,"int":10,"wis":12,"cha":10},
 "saves":{"str":5,"con":4},               // totals, only the proficient ones; else ability mod
 "skills":{"athletics":5,"perception":3}, // totals; missing -> ability mod
 "attacks":[{"name":"Longsword","bonus":5,"damage":"1d8+3","type":"slashing","reach":5},
            {"name":"Javelin","bonus":5,"damage":"1d6+3","type":"piercing","range":[30,120]}],
 "resources":{"secondWind":1,"actionSurge":1,"javelins":3,"slots1":3},
 "features":["Sneak Attack +2d6"], "notes":"prose, the DM's reference",
 "attacksPerAction":2, "resist":[], "immune":[], "vulnerable":[], "size":"medium", "noisy":true}
```

Runtime fields added by the engine: `maxHp, tempHp, init, conditions[], deathSaves{ok,fail}, reactionUsed, hidden, hideState, concentrating{spell,since}, fled, z, controller ('player'|'llm'|'dm'), player (seat name)`.

Attack extras: `critRange:19`, `finesse`, `as:'bonus'|'reaction'`, `cast:<slot level>`, `spell:true`, `spectral`.

Condition: `{ "name": "prone" }` or `{ "name": "dodging", "rounds": 1 }`. Names are free strings.

Turn state (`s.turn[id]`, reset on every `next`; reaction is on the creature):
`{ used: <ft moved>, dash, disengage, action, bonus, attacks, sneak }`; derived view `turnInfo()` adds `budget`, `left`, `reaction`, `attacksPerAction`.

Global combat state: `{ turnOrder:[id], turnIdx, round, turn:{}, pendingOA:[{id,by,target,from,z,round,turnIdx}], awaitingOAAdvance, effects:[{id,spell,owner,since,rounds,conc,pos,kind}], clock, undo }`.

Spell record (rules.js): `{id,name,level,classes[],desc,mech:{atk|save, dmg, type, range|reach, scale, mod, beams, heal, bonus}}`.

Library command contract: `{ usage, description, origin, run(s, {pos,flags}, api) }`.

### 4. Suggested minimal playable slice (this area)

Enough for a DM to run a small skirmish:

| Need | Items | What each requires |
|---|---|---|
| Stat blocks | Creature record above (no builder yet; hand-written monsters + 2-4 PC blocks, perhaps `derive` output exported once as JSON) | name, hp/maxHp/tempHp, ac, speed, stats, saves, skills, attacks, resources, resist/immune/vuln |
| Attacks | `Attack{att, tgt, weapon, adv?, bonus?, extra?}`: reach/range, LOS, cover (from perception/geometry), adv/dis folding, crit, damage with types; Extra Attack counter | `attackPlan` logic (portable nearly verbatim) |
| Damage/HP | `Damage` (with optional save+half), `Heal`, `GrantTempHp`, resist/immune/vuln, 0 HP handling + death saves for player-kind entities | `applyDamage` logic; death policy by mark/kind not side |
| Checks/saves | `Check`, `Save`, `Ruling{stakes}` + `Offer` with structured answer | skill table, d20 with adv/dis, seeded dice |
| Initiative/turns | `StartCombat`, `EndTurn`, round counter, turn tracker (move/action/bonus/reaction), dash/disengage/dodge, `use`/`regain` | `advanceTurn` semantics: reaction refresh on own turn, condition tick, skip dead |
| Conditions | prone, unconscious, restrained, paralyzed, stunned, incapacitated, dodging, frightened, poisoned, with durations and a modifier table | data table; condition source link (for concentration) |
| Opportunity attacks | provoke detection along path; offer to controller; resolve at the departure point | `provokeDetail` as pure fn; reaction used flag |
| Resources | `SpendResource`, `Refresh` (short/long); spell slots as resources | trivial |
| Rewind | provided by kernel timeline; nothing to port | -- |

Defer: concentration automation, areas, `cast`, spectral/summoned entities, morale (needs minds), builder/homebrew/suggestions, fall/water details, grapple/shove (do them as a library command first).

### 5. Traps

- **`side` is everywhere.** `hostile(a,b)` is `a.side !== b.side` (`grid.js:216`); `side==='party'` decides death saves, `living()`, controller defaults, `combatOver`, Sneak Attack ally test, OA queueing, morale targeting, and the "seen" filter. Kernel stance must replace all of it, including "who counts as down vs dying".
- **String ids are the API and appear in log text.** Every command takes `rook`, `gob3`; logs carry plain-text lines with names baked in, and `data` objects carry raw ids. Kernel must emit structured events and render per observer; the log-as-prose (`appendLog(s,'attack', "Rook attacks Gob...")`) is presentation fused to the mutation.
- **Mutation in place.** Commands mutate `s` and return it; `rollOA` temporarily teleports the target to its departure cell and restores it in a `finally` (`engine.js:347-364`) to reuse `attack`. `undo` snapshots a slice of state in `s.undo`. These tricks need real event semantics ("attack as if target were at X") in the kernel.
- **Unseeded dice.** `Math.random()` in `core.js:586`; results are formatted into strings (`adv[3,17]`) and not retained structurally. Rewind restores state but a re-run gives different dice.
- **The engine is mostly a log-and-validate layer over an LLM DM.** Class features, most spells and most conditions' effects exist only as `notes` prose and DM discipline (e.g. "decrement the resource in your head" in CLAUDE.md for Second Wind). Porting "the rules" 1:1 would mean porting ~600 lines of real mechanics; the other thousands of lines are builder tables and text.
- **Free-text conditions and features.** `hasCond(c,'stunned')` scattered lists (at least 6 different lists of "can't react"/"helpless"); features found by regexing prose (`featuresOf`); attacks found by substring match (`name.includes(weapon)`) so "Bite" matches "Spiked Bite".
- **Action economy partly implicit.** Attacks mark the action spent only after `attacksPerAction` attacks; `--as bonus|reaction` is trusted from the caller; the engine does not stop a bonus-action spell + non-cantrip action. Playtest notes 8/9 show the UI doing the gating, not the engine.
- **Turn skipping and ordering are patched.** `awaitingOAAdvance`, 100-iteration guard, `turn <id>`, `next` refusing seated players: symptoms of the DM-loop/engine split, not rules. Kernel should make turn control a policy per entity type (post-mortem P0).
- **Skills stored as totals.** Creature `skills` and `saves` are final bonuses, so proficiency, expertise and Jack of All Trades cannot change them later (builder computes and discards the breakdown; `derive` returns `acWhy`, `hpWhy` strings only for display).
- **Builder is browser + Node dual-use** (`lib/rules.js` UMD wrapper) and imports `power.js`; a Rust port should consume its output as data, not reimplement the tables first.
- **Rolls inside side effects.** `move` rolls Athletics for climbs/jumps, falls, and monster OAs *inside* the move command, with the mover's HP possibly dropping mid-path (`engine.js:290-325`). The kernel needs to decide whether a move is one step or several.
- **Concentration is tied to `effects.conc` and `concentrating{}` in two places** and only drops what the engine created; spells the DM hand-tracks need an explicit `concentrate` call.

# Appendix B: Port survey: space, maps and movement


Old engine = `C:\Users\Temho\tactical-dnd` (read-only survey). Kernel = `.claude\worktrees\rust-kernel\kernel\crates\core\src`. Line numbers are from the working tree (uncommitted work included).

### 1. Summary

1. Old model: ONE fixed rectangular grid per encounter (`rows[]` of legend chars, "C4" cells, 5 ft squares), with a per-cell height in feet. Everything spatial is a pure function of `state` in `lib/grid.js` (584 lines, runs in Node and browser).
2. The strong, worth-keeping parts: 3D-aware distance, line of sight and cover (eye/mid/head, 5 vantage points, walls with heights); edge walls and doors; ledge/climb/jump/vault/fall pathing; runtime floor/wall/building edits; sound that walls muffle; light levels.
3. There is NO multi-level or multi-map concept. "Floors" are just height numbers on one flat grid (watchtower platform at 10 ft; a cave map with a -30 ft chasm). The big goblin-warren-v2 was made seamless by hand-gluing three maps into one 26x51 grid.
4. Strain: fixed bounds (`s.width/height` checked everywhere), dense per-cell tag arrays rebuilt on each query, whole-map fog and LOS recomputed O(cells x eyes x walls), tag strings as the only extension point, coordinates as letters (A-Z = 26 columns max).
5. The kernel today has none of this: a flat `Terrain` palette (blocks_move / blocks_sight / difficult), 2D Dijkstra, 2D distance, no walls, heights, LOS, cover, light or noise. All of it must be (re)built; the old code is a good spec, a poor data model.

### 2. Feature tables

Legend for **State**: solid = used in play and covered by tests; hacky = works with known workarounds; half-built = exists but unfinished or untested; unused = no encounter/command uses it.

#### 2a. Grid, coordinates, distance

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Letter+number cells | "C4" = col C, row 4; parse/format | `lib/grid.js:12-19` | single letter A-Z, number 1.. | solid but capped at 26 columns | rethink | Kernel uses `Cell{x,y}` ints: keep. Keep letter form only as a display/script alias, extended (AA...) or dropped |
| In-bounds check | rejects off-map cells | `grid.js:20` | `s.width/height` | solid | rethink | Seamless space has no hard bounds: replace with "is this cell loaded/defined". `Map::in_bounds` today |
| 3D distance | Chebyshev in x/y plus height/5, rounded | `grid.js:25-28` | cells carry optional `z` (ft) | solid | port | kernel `Cell::distance_ft` is 2D only; add z |
| Ranges between two points | distance + LOS + cover + height delta | `engine.js:177` `range` | creatures or cells | solid (DM uses it constantly) | port | A kernel query, not a command |
| Named places | landmarks and areas by name; speech rewrites squares to names | `lib/places.js:1-66` | `places:[{name,at|area}]` rect strings | solid | rethink | Becomes the "zone/region" layer; names for speech and DM, not geometry |
| Zone guides | prose docs per encounter (areas, routes, hooks) | `encounters/*.zones.md` | markdown, cell refs | hand-written docs only | rethink | Author-facing; real zones should be data (id, bounds/cells, tags, light, name) |

#### 2b. Terrain, tags, objects, height

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Legend + rows | each map char -> `{name, tags[], elev?, object?, climbDC?, depth?}` | `grid.js:33-56`; `encounters/*.json` | `rows[y][x]` char | solid | rethink | Same idea as kernel palette+tiles; kernel palette is far poorer (3 bools) |
| Tag vocabulary | difficult cover-half cover-3q climbable unclimbable impassable wall opaque flammable narrow fire-source can-topple high-ground explosive water slick lit dark dim chasm pit bridge stairs rope burning tracks no-tracks | `grep` over encounters; `core.js:373-380` TAG_TEXT | free strings | solid, ad hoc | rethink | Keep the verbs, make them typed (bitflags or enum + params) and data in the codex |
| Movement/sight block rules | `wall|impassable` blocks move; `wall|opaque` blocks sight; `difficult|water` costs double | `grid.js:199-201` | tags | solid | port | Kernel `blocks_move/blocks_sight/difficult` is the same three; add `cover`, `climb`, `slick`... |
| Floor height | `heights` grid (digit = 5 ft step, or numbers) else legend `elev` else 0 | `grid.js:62-77` | `heights:[string|number[]]`, `heightKey` | solid (watchtower, warren-v2 chasm) | rethink | Per-cell `floor_ft` integer; single choke point is a good idea |
| Props/objects on cells | `{kind,height,stand}`; crates/tree/pillar; standable adds to elevation | `grid.js:82-106`; `objects:[{at,...}]` | legend `object` or `s.objects` | solid | rethink | Should become real entities with HP/tags (rust-kernel-api P2); height stays a property |
| Runtime tag edits | add/remove a tag on cells (burning, impassable...) | `engine.js:606` `terrain`; `grid.js:31-53` | `s.tagOverrides[cell]={add,remove,h?,ch?}` | solid; overrides reset on `load` | rethink | Kernel is event-sourced: these become `TerrainChanged{cell,...}` events, not a mutable side map |
| Runtime glyph swap + floor height | change floor ft and/or surface of cells; occupants fall (1d6/10 ft) or ride up; stranded warning | `engine.js:650-755` `floor`; `grid.js:33-35,62-72` | `o.ch`, `o.h` | half-built: dynamic-floor.md says "design only" but code and tests (`test.js:694+`) exist; `rust-kernel-api.md` says tests were never run | port | Core of "map at runtime" (P1). Good spec for terrain mutation events |
| Hanging structure | cut bridge hangs down the cliff from its anchor, climbable at walk+1ft/ft | `engine.js:638-648,688-695`; `grid.js:36-42,347-355`; `map3d.js:581,845` | tags `hang-<n|s|e|w><len>`, `rope`, `climbable` | half-built (single use case: goblin-warren-v2 bridge L41:M46) | drop as special case | Subsume in "climbable edge/surface" + terrain change; don't encode geometry in tag strings |
| Tracks/ground reading | tag-based soft ground; Survival reads age/size/heading | `engine.js:2092`; `core.js:299,342` | tags + `s.tracks` | solid | rethink | Perception/identity system's job, not map's; map only supplies "ground keeps prints" |

#### 2c. Walls, doors, windows, buildings

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Edge walls | walls run along grid lines between vertices ("D2-D6" = left side of column D rows 2-6); indexed as unit edges `v{x},{y}` / `h{x},{y}` | `grid.js:130-162` | `walls:[str|{from,to,kind,id,open,hidden,height,tags}]` | solid | port | Best data-model idea to keep: a wall is an edge property, not a blocked cell. Kernel has only blocked cells (walls are `#` tiles) |
| Wall kinds | wall, door, window (impassable + half cover), low (half cover, +5 ft to cross) | `grid.js:137-139` | `kind` -> tags | solid | port | Edge flags: blocks_move, blocks_sight, cover, difficult, height |
| Diagonal rules | a diagonal step counts every wall at the corner; cannot squeeze between two solid corners (not by a lone corner) | `grid.js:165-176,320-327` | edges + `fillsCorner` | solid | port | Kernel has the two-blocked-corners rule for cells only |
| Doors | open/close/lock/unlock; `--by` NPC hears it (40 ft); keys; `hidden` secret door revealed by opening; `--force` after a ruling | `engine.js:848-873` | wall `{id,open,locked,hidden}`; creature `keys:[id]` | solid | port | Door = edge with state; open/lock events; sound hook |
| Runtime walls | add or remove walls mid-game | `engine.js:756-785` `wall` | pushes into `s.walls` | half-built (tested once, same untested caveat) | port | Edge-set mutation events |
| Buildings | stamp a rectangle of perimeter walls + one door + optional floor swap, named group | `engine.js:786-847` `building` | `group` slug on walls | half-built | rethink | A convenience macro; in a seamless world a building is a authored region (shell + interior + entrances), see section 4 |
| Wall height | `height` ft over highest adjacent floor; low walls 3 ft; otherwise infinite | `grid.js:490-494` | `w.height` | solid | port | Needed for parapets, half walls |

#### 2d. Pathing and movement

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Dijkstra on 8-neighbours | cheapest route within speed; diagonals cost 5; reports cost and per-step kinds | `grid.js:284-447` | typed steps `{kind,to,cost,...}` | solid; perf fixed 2026-10-13 | port | Kernel `movement.rs` Dijkstra is the same skeleton (84 lines) |
| Stable heap + line tie-break | equal-cost routes hug the straight start-goal line (no zigzag) | `grid.js:236-266,309-315` | TIE=1e-5 x deviation | solid | port | Kernel breaks ties by fewest diagonals (different, fine) |
| Difficult terrain | entering costs 10 instead of 5 (flyers ignore) | `grid.js:341` | tag `difficult|water` | solid | port | Kernel charges on LEAVING difficult (house rule, noted in `movement.rs`). Pick one; PHB is entering |
| Wall crossing cost | low walls +5; windows/walls block | `grid.js:339-341` | edge tags | solid | port | edge flags |
| Hostile-occupied squares block | allies pass through, enemies don't; cannot end on an occupied cell | `grid.js:316,207-215`; `engine.js:188-` | `side`/hostility | solid | port | Kernel already does this via `stance` (more nuanced) |
| Climbing | step up/down >=5 ft costs 2x vertical; stairs <=5 ft free; climb speed = 1x; `unclimbable` blocks | `grid.js:342-360` | floor delta, tags | solid | port | New: needs per-cell height first |
| Fast climb | full speed but an Athletics check vs climb DC; failure falls | `grid.js:358`; `engine.js:206-230` | `climbDC` (legend or map) | solid | port | Check hook = a pending `ruling` in the kernel |
| Jump | straight-line long jump over gaps/difficult/low walls; width <= Str (half standing); height obstacles clear to 3+Str mod, taller = Athletics DC 5+3/ft | `grid.js:365-406` | per-creature Str, run-up 10 ft | solid | port | Needs creature stats; deliver after movement basics |
| Leap/vault/grab up ledges | land on a ledge, vault (DC), or grab lip and haul | `grid.js:408-423` | `opts.jump/vault/fastClimb` | solid but intricate | port later | Rarely used; a ruling can cover it |
| Opportunity attacks | leaving a hostile's 3D reach along the route, per step, skipping hiders not noticed | `grid.js:536-553` | reach, reaction used | solid | port | Kernel P1 |
| Movement modes | `fly` ignores difficult and ledges; `climb` speed | `grid.js:230,289` | free text `movement` | hacky (regex on text) | rethink | Typed speeds (walk/fly/swim/climb) per rust-kernel-api P0 |
| Dash / prone / budget | double budget; prone halves | `engine.js:196-` | `s.turn[id].used` | solid | port | Turn state |
| Undo / rewind | take back last move; whole-state snapshots | `engine.js:436`; `rewind` | `s.undo` + snapshots | solid | rethink | Kernel timeline already does this better |
| Forced moves | `place` (no cost, no pathing), `shove` ext | `engine.js:382`; `ext/shove.js` | direct pos set | solid | port | `Teleport/Displace` event, no OA, no perception leak (P1) |
| Falls | 1d6/10 ft (max 20d6), prone, water halves, Athletics/Acrobatics for clean entry | `engine.js:86-109,367` | height delta, `water` tag | solid | port | Event with dice from timeline |
| Swimming | `water` = difficult only; `depth` on legend unused for mechanics | `grid.js:201` | tag + `depth` | half-built | rethink | Needs swim speed and depth (rust-kernel-api: "flying and swimming") |

#### 2e. Sight, cover, light, fog, noise

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| 3D LOS | trace from eye (+5 ft) to target head (+5) and middle (+2.5) from 5 vantage points in the origin square (centre + 4 corners); blocked by tall ground, walls, opaque props | `grid.js:465-509` | Bresenham cells + exact wall crossings + heights | solid | port | The most valuable algorithm in the file; spec it with tests, then reimplement |
| Cover | half (+2) / three-quarters (+5) from `cover-*` squares/walls above the line; head-only visible = 3/4 | `grid.js:511-529` | tags + heights | solid | port | Return a value, not a command |
| Visible set / fog | party's seen squares = any cell hit by any party eye; `explored` accumulates; `fog off` reveals all | `core.js:138-159`, `engine.js:598` | O(W x H x eyes x 10 traces x walls) | solid, but costly; cached per request | rethink | Perception pipeline in kernel-perception.md; use incremental/chunked visibility, per-observer |
| Per-observer view | cells `{fog,terrain,ch,tags,h,obj}` + walls once an adjacent square is known; secret walls DM-only; unknown = `{fog:'unknown'}` | `core.js:174-215` | JSON copy of whole grid | solid, heavy | rethink | Send deltas/chunks; never the whole grid |
| Browser-side routing | `fromView` rebuilds a pathable state from the player view; unknown squares block | `grid.js:555-577` | same pure functions in browser | solid | rethink | Kernel route preview is server-side; WASM could reuse core |
| Light levels | ambient (`bright|dim|dark`) + areas + tags `lit/dim/dark`; creature `light:<r>` and fires brighten (r bright, 2r dim, LOS-checked); darkvision +1 step | `minds.js:109-146,181-183` | `lighting:{ambient,areas:{rect:level}}` | solid | port | Part of perception; light sources as entities |
| Observer sight | facing cone (110 deg, periph 60), clarity by distance/light/cover; hide judged per observer | `minds.js:173-200` | mind facing, passives | solid | port (perception-owned) | Already in kernel-perception design |
| Noise propagation | sound has origin and loudness (ft); effective distance = 3D distance + wall muffling (wall 30, door 20, window 10, solid cell 30); clarity clear <=0.6 / muffled <=0.95 / faint | `minds.js:202-221,322-339,616-640` | `appendLog({noise:true,cell,loud})`, `doors` | solid | port | Needs wall/door edge data. Uses straight line, NOT pathing (no sound around corners/through open doors beyond wall count) |
| Stealth positions | hide/sneak with cover and light; footsteps 30/60/15 ft | `engine.js:902,2088`; `minds.js:322` | `hideState` | solid | port (perception) | |
| Thrown/AoE templates | none: area spells rolled as `damage <id> ... --save` per target by hand | `CLAUDE.md` table; `rules.js` spell blurbs | none | unused (explicitly a missing primitive in rust-kernel-api P1) | new | Needs sphere/cone/cube/line/cylinder over cells with LOS-from-point |

#### 2f. Multi-area / floors / zones

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Multi-map / transitions | none. `load <encounter>` replaces the whole state and wipes the log | `engine.js:117-137` | one file = one map | does not exist | new | The central gap for "seamless" |
| Multiple floors | none. Height is a z value on one plane; no ceilings, no stacked rooms, no overlapping footprints | n/a (watchtower platform = 10 ft cells) | `heights` | does not exist | new | Needs layers or true 3D cells |
| Glued maps | warren-v2 = rope-bridge + caves + new approach hand-merged into one grid (rows 1-35 untouched, rows 36-50 new) | `encounters/goblin-warren-v2.zones.md:1-12` | 26x51 `rows` | hacky but it played | drop approach | The authoring pain that "seamless" should remove |
| Regions with rules | `places` (names), `lighting.areas` (rect light), guard posts/patrol routes (in minds) | `places.js`, `minds.js:109`, zone md files | rect strings `"F11:U19"` | solid for what it is | rethink | Unify into one region concept |
| Interior vs outdoor | no concept; tollhouse = grass border + walls on edges + `lighting.areas` darkness | `encounters/tollhouse.json` | walls+lighting | hacky but works | rethink | Region flag `roofed` / sky exposure (affects light, fog, noise, weather) |

### 3. The old spatial data model

One encounter file (JSON) becomes `state.json` (about 840 KB by the end of a long session). Spatial keys:

```jsonc
{ "legend": { "#": {"name":"rock wall","tags":["wall"]},
              "C": {"name":"chasm","tags":["chasm","impassable"],"elev":-30},
              "c": {"name":"crates","tags":["difficult","cover-half","climbable"],"object":{"kind":"crate","height":4}} },
  "rows": ["######", "#..cC#"],            // width = rows[0].length, height = rows.length (all rows equal)
  "heights": ["..222"],                    // optional: digit = 5 ft step; "." falls back to legend elev
  "climbDC": 13,                           // map-wide default; legend climbDC overrides
  "walls": ["B8-D8", {"id":"door1","kind":"door","from":"D8","to":"E8","open":false,"locked":true,"hidden":false,"height":null}],
  "objects": [{"at":"C3:D4","kind":"cart","height":4,"tags":[],"stand":true}],
  "lighting": {"ambient":"dim","areas":{"D2:I9":"dark"}},
  "places": [{"name":"the cookfire","at":"J14"},{"name":"the pen","area":"P12:T14"}] }
```

Runtime edits, all in state, not in the file:

```jsonc
"tagOverrides": { "L41": {"add":["hang-n6","climbable","rope"],"remove":["impassable"],"h":-30,"ch":"C"} },
"explored": ["A1","A2", ...],   // every cell id the party ever saw, array of strings
"walls": [ ...pushed by wall/building/door... ],
"creatures": { "rook": { "pos":"H8", "z": 15 /* only if aloft */, "size":"medium", "height":6, "movement":"fly", "speed":30, "light":20 } }
```

Derived at query time, never stored: `tagsAt` (legend tags + placed object tags + overrides), `elevAt` (= floor + standable prop), wall edge index (`wallIndex`, rebuilt per call), LOS lines.

Assumptions baked in:
- One rectangular grid, row-major strings; width fixed at load. `inBounds` is checked in pathing, jumps, building, floor, fall, view.
- One cell = one terrain char, one floor height; no ceiling, no second storey over the same (x,y). A cell can hold only ONE standing height.
- Everything addressed by A-Z + number; `parseCell` throws on `AA1`.
- Creature = one cell (size affects only height, not footprint). Large/huge creatures occupy 1 cell; no multi-square bodies, no squeezing rules.
- Tags are open strings; behaviours check with `.includes('x')` scattered across `grid.js`, `core.js`, `minds.js`, `engine.js` and both viewers. `hang-n6` shows the end of that road: geometry encoded in a tag name.
- The viewer re-derives from the whole view JSON on every change (cells x tags). Edit-friendly, but O(map) in size and in fog/LOS.

### 4. Where it strained

Concrete, with evidence:

1. **No transitions between spaces.** The only way to move from "outside the warren" to "inside the warren" was to have authored them as one grid. `goblin-warren-v2` merges three encounters into a 26 x 51 grid (`goblin-warren-v2.zones.md`: "the rope-bridge approach, a new entryway and the whole caves complex in one map") and keeps "no shift" in rows 1-35 so old cell references stay valid. A seamless kernel should make this a normal operation (adjacent regions, shared border), not a rebuild by hand.
2. **Everything is whole-map.** `visibleSet` walks every cell for every party eye with up to 10 traces per pair, scanning all wall segments each time (`core.js:140-150`, `grid.js:179-194`). Mitigation was a per-request cache (`sightCached`) and, for the browser, 8x8 render chunks (`map3d.js:242`). `HANDOFF` reports Hide preview cost on `/api/path`: 1 s to 25 ms after caching. A big or unbounded world cannot do this; it needs chunked/lazy visibility.
3. **The runtime map was a patch layer.** `dynamic-floor.md` was written because `floorFeet` was fixed for the whole encounter and the only runtime edit was `terrain add|remove <tag>`. The cut rope bridge was faked as `terrain L41:M46 add impassable`; cells stayed at 0 ft, so nothing fell and range/LOS/cover treated the gap as ground. Fix: a per-cell override map, an absolute-height override, a glyph override, plus a fall handler for occupants and a hanging-bridge hack. Limits it exposes:
   - state is a mutable side-table (`tagOverrides`) rather than events;
   - creatures standing on a changed cell silently change elevation (the "main behavioural trap");
   - a fall lands in the SAME cell; a creature in a pit cell tagged `impassable` is stranded (the command only prints a warning);
   - a move is atomic: nobody can stop halfway up a rope (needs `c.z` aloft state);
   - several readers did `s.legend[s.rows[y][x]]` directly and had to be audited (`grid.js`, `core.js:185,449`, `minds.js:1175`).
4. **Walls are on edges, floors are on cells, and they disagree.** Wall height is measured against "highest adjacent floor" (`wallTop`); drop one side and it still works, but there is no ceiling, no overhang, no window above a floor.
5. **No floors/levels.** Two stacked rooms cannot exist: one (x,y) = one height. Stairs only work as `<= 5 ft` steps on a single plane. Multi-storey buildings, caves with overpasses, towers with interiors, trapdoors that lead to a lower room: all unsupported. The `building` command makes a 1-storey box only.
6. **Fixed bounds and naming.** 26 columns max (single letter); row numbers unlimited. `building` fails if it runs off the map; nothing can extend the map (no `grow`/`expand`).
7. **Tags as the extension point.** 25+ tag strings tested with `.includes` in many files; `hang-*` regex-in-tag; `fire-source`/`burning` re-scanned over the entire grid every light query (`minds.js:122-128` loops all cells). `TAG_TEXT` (the player-facing descriptions) is a second list to maintain.
8. **Sound ignores topology.** Muffling counts walls along a straight line; no path around a corner, no open door vs closed (only closed doors are in the wall set), no ceilings or floors between levels. Shout in one room and the next room across a thin wall is "muffled"; a long winding corridor is "clear".
9. **Light is recomputed per query** with an LOS check per light per cell; fine for 26 x 51, not for large outdoors.
10. **Creatures are one-cell.** Large/Huge/Gargantuan have `height` but not footprint; no squeeze/shove-by-size, no flying altitude rules beyond `c.z` (set by hand), no swimming depth.
11. **Browser and server run the same code.** Good (previews match the referee) but it ties the model to JS, and `fromView` must reconstruct a fake state from the view: "unknown squares block". Seamless space (cells loaded on demand) breaks that unless the view can say "not loaded yet".
12. **Perception expects a finite, fully-known grid.** `explored` is an ever-growing list of every cell id the party saw (in the saved state), no region ids.
13. **No area templates, no persistent zones.** Fire spreads by hand (`terrain add burning`), and "starts the turn in fire" is flagged only for `burning` (`engine.js:1012`). `rust-kernel-api` lists persistent zones as P2, areas as P1.

What the kernel itself says about space (rust-kernel-api.md): "elevation changes" and "cell-to-cell line of sight", "noise loudness" are listed under missing primitives that cost the 2026-10-21 session time; P1 wants "floor height, glyph and surface swaps, walls, doors and windows. Line of sight, range and look between any two cells, with height included" and "noise loudness that scales with how loud it is (an explosion carries warren-wide)".

### 5. Suggested minimal slice (small skirmish map)

Order matters: each step is testable with the old function as an oracle (port `test.js` cases for pathing, LOS, cover).

1. **Coordinates and distance** with z: `Cell{x,y}` plus `floor_ft: i16` per cell; `distance_ft` includes height/5.
2. **Terrain palette**: keep `blocks_move/blocks_sight/difficult` and add `cover: none|half|three_quarters`, `climbable`, `slick`, `water`, `light_emit`. Optional height for props (`prop_height_ft`) so crates/pillars are legible.
3. **Edge walls and doors** (new `Edges` set): per unit edge `{blocks_move, blocks_sight, cover, difficult, height_ft, door:{open,locked,hidden}}`. Diagonal corner rule from `grid.js:165-176,320-327`.
4. **Pathing**: the existing Dijkstra plus (a) walls/doors, (b) climb cost for >= 5 ft steps (2x vertical, stairs free), (c) the dash/speed budget. Skip jumps, vaults, fast-climb on day one (a DM ruling covers them).
5. **Line of sight and cover** via the old eye/mid/head, 5-vantage scheme with wall heights. This is needed for ranged attacks, opportunity attacks, hiding and noise and is the main reason for a "range" query.
6. **Falls and forced movement**: `place`/`fall` events (1d6 per 10 ft), cell floor change events (`floor`) so a collapse or cut bridge works; occupants drop. No hang/rope special-casing.
7. **Light levels per region and per source** (ambient + tagged areas + torches) feeding perception.
8. **Noise**: origin + loudness; effective range = 3D distance + wall/door muffling (30/20/10 ft). Keep the old constants; improve later to path-based.

Defer: jumps/vaults/hanging structures, buildings macro, fog-of-war persistence (`explored`), area templates, swimming, large-creature footprints.

#### Pointers for seamless space (not in the old engine; design questions raised by it)

- Make the world a set of **chunks or regions that share borders** (not a bounded grid): cells addressed as global (x, y, layer), unloaded chunks reported as "unknown", not blocking.
- Make **levels first-class**: a cell column can hold several floors (floor_ft, ceiling_ft, optional void between). Stairs/ladders/trapdoors are connectors between floors, not height steps.
- Make **regions** the one concept for: names (`places`), light areas (`lighting.areas`), indoor/outdoor, sound dampening, patrol/guard anchors. Rects today; allow polygons or cell sets.
- Treat **doors and openings as the connections** between regions: sound, light, pathing and fog all pass through them.
- Make terrain changes **events** (cell/edge/region mutate) so the same path, LOS and noise code serves collapses, fires and doors; avoid ad hoc side tables.
- Keep **visibility incremental**: per observer, chunk-bounded rays, cached per (observer, chunk, version); that is what `visibleSet` could not do.

# Appendix C: Port survey: NPC minds, perception, stealth, social play


Source: `C:\Users\Temho\tactical-dnd` (read-only survey). Paths below are relative to it. Kernel context: `.claude/worktrees/rust-kernel/docs/kernel-perception.md`, `rust-kernel-api.md`.
Evidence base: `lib/minds.js` (2165 lines), `lib/think.js` (253), `minds.config.json`, `docs/stealth.md`, `docs/minds-v3.md` (design only, never built), `docs/playtest-notes.md`, `.claude/agents/{npc,pc}.md`, engine.js commands, `lib/core.js` trails. I did not run anything. `test-minds.js` (584 lines) was not read in detail.

### 1. Summary

1. The old engine ran perception after **every** state-changing command (`perceive`, minds.js:521) and wrote per-NPC observations, tracks (last-seen belief records), alarm and a "pending" trigger list; models only ever saw a text **brief** built from that mind, never the truth.
2. Decisions were one JSON object per think (beliefs with cited evidence ids, alarm, intention + plan steps, speech, orders), **validated field by field** in `decide` (minds.js:1733) with partial acceptance, stale detection, "forgiving" auto-fixes and a deterministic `fallbackPlan` so the world never stalled.
3. Social play was surprisingly deep and mostly solid: speech channels with muffling/garbling, voice recognition, impersonation vs passive Perception, certainty/bluff/persuasion credibility, standing orders with adherence, rumour "claims", morale/rout/surrender.
4. What hurt in play (post-mortem): reactive NPCs impossible (replies hand-written or forced `think`), mind setup/edit only via full `setup`, stale evidence not retractable, 126-line briefs hard to debug, noisy output, morale had no lever until a late fix. v3 (referents, marks, tasks, working memory) was designed after the Greyhold Barracks playtest but **none was built**.
5. The kernel design (marks + reading trees, individuals, traces, recall, stance, agent reply gist/actions/flag) replaces the *perception/knowledge* half cleanly; **no home yet** for alarm, plans/intentions, orders/standing orders, claims/credibility, morale, the fallback policy, tick/time out of combat, tracking trails, cost accounting.

Legend. State: solid / hacky / half-built / unused. Port: as-is (logic carries over) / rethink / drop.

---

### 2. Feature tables

#### 2.1 Mind setup and data held

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Mind block on creature | Encounter gives `mind:{role,faction,rank,tier,post,patrol,facing,fov,personality,senses,disposition,motivations,relationships,bark,knows}`; defaults filled | minds.js:38 `initMind`; docs/stealth.md "Authoring" | profile + 7 disposition floats (vigilance, courage, obedience, curiosity, impulsiveness, sociability, superstition) | solid; `setup` is the only edit path (post-mortem: "persona changes only via full setup") | rethink: needs in-place edit | Individual/creature def + disposition (kernel dispositions are toward identities, not these temperament floats: **no home** for temperament) |
| Tier -> model | minion/elite/commander -> haiku/sonnet/opus; per-NPC `model`, per-encounter `mindConfig.models`, table `minds.config.json` | minds.js:6, 1884-1891 `modelFor`; minds.config.json | string; slash in id = OpenRouter | solid; config now sends all three tiers to deepseek-v4.1-flash | as-is | agent routing (not in kernel doc) |
| Roster (who I know) | Own-side creatures known by name/role/rank/post, never positions; duplicate names disambiguated by role | minds.js:68-77 | `m.roster[id]={name,role,rank,post}` | solid; v3 notes it hands the model identification it never made | rethink | Identities/groups (red-watch) + individuals; roster of faces vs names is a v3 idea ("names and faces separate") |
| Relationships | trust/loyalty/authority/notes per known person; seeds credibility and adherence | minds.js:78-82 | `m.relationships[id]` floats | solid | rethink | Personal relation overriding disposition in stance; trust/authority scalars have **no home yet** |
| Motivations | Free-text goals with priority/source/persistence | minds.js:63-67 | `[{id,description,priority,source,persistence}]` | solid, only shown in brief | as-is | Agent persona context; salience-by-interest (v3 §4) |
| Observations (`obs`) | The mind's evidence list with ids, cited by beliefs; older ones roll to `memory` (60 cap) | minds.js:291 `note`, 722 `passTime` | `{id,t,seq,modality,kind,text,cell,sig,alarmAdd,subject}` | solid; consolidation is deterministic truncation only | rethink | Memory trace (but old obs were *prose with ids*, kernel traces keep marks + readings) |
| Tracks | Per-referent belief of where something is, how clear, direct vs reported, history; opaque keys `x1`, `?3` | minds.js:344-436, 437 `identify` | `{key,label,side,level,cell,t,direct,inView,kin,history,credence,sources,static,searchedAt}` | solid but conflates identity, location and stance | rethink | Individual (handle -> individual) + last-seen trace; `level` identified/figure/movement = reading depth |
| Beliefs | Model-authored propositions with confidence, status (hypothesis/accepted/disputed/rejected), evidence/contradicts ids | minds.js:1747-1768 | cap 12; `{proposition,confidence,status,supporting,contradicting,where,subject}` | solid; evidence citation enforced | rethink | Agent-reply "actions" (belief update) with provenance to traces |
| Intentions / plans | Objective + 2-4 step plan, step pointer, `reconsiderWhen`, source model/fallback/morale/hold | minds.js:1515 `current`, 1523 `checkStep` | step kinds move,flee,guard,patrol,watch,investigate,attack,follow,say,door,hide,wait | solid, but only ~12 step types | rethink | Agent reply "actions"; plan persistence **no home yet** |
| Alarm | 0-100 intensity, levels routine/curious/alert/combat; bumps by sig*vigilance, cools each round; floor when hostile in sight; shown on map as ?/! | minds.js:259-283, 722 | `m.alarm{intensity,level,causes}`; SIG_ALARM {0,12,25,50} | solid, heavily tuned (calm lairs, superstition) | rethink | Stance/arousal; **no home yet** (closest: v3 "arousal" narrowing attention) |
| Pending triggers | Perception adds `{why,urgency 1-3,refs}`; decide when urgency >= `deliberateAt` (2) | minds.js:285 `trigger`; docs "Deliberation" | list per mind | solid | rethink | Flag (`routine/judgement/ambiguous/needs_dm`) + DM queue; kernel decides *who needs thinking* differently |
| Traces / stats | Per-decision accepted/rejected log; `mindStats` counters | minds.js:2120 `queue`, 2136 `inspect`; `mind <id> trace` | `m.traces`, `s.mindStats` | solid | as-is (concept) | Timeline step + journal |

#### 2.2 Perception (ran after every command)

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Perception pass | After each command: diff positions, rebuild paths, run sight/sound/touch/scent per mind, emit DM + party lines | minds.js:521-597 `perceive` | `snapshot` of pre-positions; log entries; per-mind `scan/touch/hear/smell` | solid; O(minds x creatures) each command, ~840 KB state reparsed per CLI call (post-mortem) | rethink (event-driven) | Reading pass producing traces on replay (build-order step 3) |
| Sight | LOS in 3D, light (ambient/areas/torches/fire), darkvision, facing (110 deg, peripheral past 60), distance/cover/dim blur -> `clarity` 0-1 | minds.js:173-200 `sightOf`; lightAt 131 | `{clarity,lv,dist,periph,cover}` | solid | as-is (formulae) | Mark conspicuity per sense, attention passing; clarity thresholds map to reading depth |
| Clarity -> identification | >=.65 identified, >=.35 "unidentified figure", else movement; comrades >=.45; same-size "built like one of yours" benefit of doubt; speaking in a comrade's voice vouches | minds.js:437-464 | track `level`, `kin`, `_vouched` | solid, a nice mechanic | rethink | Reading tree ladder (passing -> attending); "kin by size" is a stance-from-marks rule |
| Path-based sighting | Scans every cell of a mover's path so a mover crossing a gap is seen "just for a moment" | minds.js:344-360 | `paths[id]` | solid | as-is | Movement events carry path; reading per step |
| Passive Perception | `10+skill` (+5 keen) or `profile.passive`; compared to Stealth total with -5 dim/peripheral | minds.js:97, 188 | `skills.perception`, `senses.keen` | solid | as-is | Passive scores in reading gates (kernel does -5 for non-proficient, different rule) |
| Hearing | Sound has origin + loudness (ft); walls soak 30, door 20, window 10; footsteps 30 (60 noisy), hidden scuff 15 gated by passive; fight 90; bowstring 20; thunder 300; asleep halves, keen x1.5; blurred location | minds.js:202-222, 317-343, 488 | `{at,loud,desc,sig,src,quiet,kind}` | solid but "straight line + wall penalty, winding cracks muffle far too much" (stealth.md) | rethink propagation, keep numbers | Speech/noise as marks reaching sense=hearing |
| Hearing words / voice | Share of earshot used: <=60% every word + known voice, 60-80% words dropped (deterministic garble), 80-95% voice only if named, >95% "distant voice" | docs "Hearing words"; minds.js:224 `garble`, 231 `namesSelf` | `clarity clear/muffled/faint` | solid | as-is | Speech mark with language gate; garble = failed gate fallback |
| Touch | Hit/missed/hurt gives direction; unseen attacker spawns a guessed hostile track | minds.js:465 | observation kind touch | solid | as-is | Trace with sense=touch |
| Scent | `senses.scent` range notices strangers through walls, no identity, 2-round cooldown | minds.js:507 | `m._smell` | solid, small | as-is | Mark with sense=scent |
| Doors seen | Remembered door state per mind; differing on sight is news (quiet if comrade moved it / calm lair) | minds.js:395-420 | `m.doors[id]={open,t}` | solid | rethink | Expectation-violation (v3 §3, unbuilt) |
| Body / evidence | Fallen body from afar "lies still"; within 10 ft "is dead" + evidence strings | minds.js:371-390; engine `evidence` | `s.evidence[id|cell]=[text]` | solid | rethink | Deferred/hidden marks on an entity revealed at `attending` within range |
| Sleep | Asleep can't see, hears at half, a sound wakes | minds.js:493 | condition asleep | solid | as-is | condition gating senses |
| Lost contact reach | Track keeps last-seen cell/time; brief computes region reachable at 30 ft/round with doors | minds.js:1117-1160 `reachable`, `regionText`, brief 1420 | pathing flood | solid, very effective (search planned against it) | as-is | `umwelt` derived "could be anywhere in X" |
| Party perceives world | Everything the party sees/hears of NPCs/sounds goes to chronicle with perceivers, sense, bearing + distance word, never name/square | minds.js:611-646 `partySees/partySense/partyNarrate`, 716 | log `data:{perceivers,sense,dir,dist}` | solid | rethink | Per-seat rendering of events in observer's names (already kernel principle) |
| Alert narration | Map `?`/`!`/red `!` over NPCs the party can see; line on level change | minds.js:699-720 `seeLine`, `cueLine` | `c.cue` | solid | as-is | Presentation |

#### 2.3 Stealth, hiding, sneaking, tracking, searching

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Observer-specific hiding (house rule) | One Stealth total stored; each observer judged separately (`hideState.detectedBy`); no global Hidden condition | docs/stealth.md "Table rule"; minds.js:648 `hideCheck`, 676 `applyHideResult` | `c.hideState={stealth,detectedBy[]}`; legacy `c.hidden` | solid, but legacy `hidden` flag coexists ("DM secret") = hacky duality | rethink | Per-observer reading with Stealth as the roll backing "present/absent" mark; clean fit |
| `hide --auto/--total`, `sneak` | Judge a total against every would-be watcher; refuse if all see in bright light w/o cover; print who notices | engine.js:902; 2088 | `hideCheck` rows `{id,pp,notices,why}` | solid; engine doesn't spend the action | as-is | Command + roll event |
| Hide preview | Wheel/HUD shows only known geometry, never passive scores | minds.js:685 `hidePreview` | visible-creature filter | solid | rethink | Seat view rendering |
| Discovery by plain monsters | Non-mind monsters also detect an exposing hider | minds.js:522-535 | | solid | as-is | same reading path (mindless creatures still observers) |
| Search / investigate | NPC step: go within 5 ft, Perception roll vs Stealth of hiders within 10 ft; also finds square evidence; records `checked[cell]` | minds.js:2092 `search`; engine.js ~1790 | `m.checked`, `s.evidence` | solid | as-is | Attending reading action with roll event |
| Noise | `noise <cell> "desc" --loud ft --sig` : DM-created sound | engine.js:2072 | sound record | solid | as-is | Mark with sense=hearing, loudness |
| Tracking trails | Creatures leave per-cell prints (6 cap, 60-round life) on ground tagged tracks/wet/mud/etc.; Survival DC by ground + age; success tiers give age/heading, +3 size/kind, +8 heavy gear; never names | lib/core.js:291-344; engine.js:2092 `track` | `s.trails[cell]=[{who,t,from,size,kind,heavy}]` | solid (playtest note 14 asked for it, delivered) | as-is | Residual marks on a cell (decaying), reading gated by Survival |
| Plain-monster passive stealth detection | Passive vs stealth (house) | minds.js:188 | | solid | as-is | |

#### 2.4 Evidence, describe, inspect, look

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| `evidence` | DM plants clue text on creature/cell; NPCs find by close look or search | engine.js:1422; minds.js:2108 | `s.evidence{key:[text]}` | solid, but free text (no reveal tiers/gates) | rethink | Mark with reading tree (attending, gate e.g. Medicine) |
| `describe` | Records what the *party* knows; shows on inspect card | engine.js:1405 | `s.known{key:[fact]}` | solid, DM-authored | rethink | Player trace/recall share; "known" facts are traces for the party |
| `look` / INSPECT | What a party creature can tell about a target (health, footing, attack reach), DM adds more via Perception/etc., then `describe` | engine.js:1439; core `C.look` | | solid; judging is DM-by-hand | rethink | `umwelt(who, focus)` + gated facets; kernel is a big improvement here |
| `mind <id> notice` | DM injects a perception ("smell of smoke", "your nerve breaks") | engine.js:1930 verb | obs with sig/at | solid, essential escape hatch (used for morale before rout existed) | as-is | DM-authored event with trace |

#### 2.5 Speech, social, impersonation

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Channels | whisper 5 ft, speech 30, shout 150, signal (LOS); everyone in earshot hears incl. party, enemies too | minds.js:12, 889 `speak`, 939 `earshot` | `CHANNELS` | solid | as-is | Speech mark (sense=hearing) with loudness; signal = sight mark |
| Message kinds | report/question/answer/order/warning/acknowledgement | minds.js:11 | | solid | as-is | speech act on the mark |
| Speech never carries squares | Rewritten to place names ("by the cookfire"); exact `about.at` travels structurally "like pointing" | docs "Places"; lib/places.js | `s.places` | solid | as-is (concept) | Pointing mark (kernel doc "Pointing") |
| Heard messages -> reported tracks | Recipient gets track `direct:false` with sources/relay chain; two contradictory reports stay two tracks | minds.js:973-1100 `receive` | `credence`, `sources` | solid | rethink | Testimony as marks with source; told vs saw (v3 §2.6) |
| Voice recognition | Known voice at <=80% earshot; else "a voice that might be X's"; unseen speaker labelled by direction | minds.js:952 `speakerAs` | `m.voices[key]` | solid | rethink | Voice mark + recognition by familiarity |
| Impersonation | `speak --as npc --deception N`: listeners who know the voice compare passive Perception to Deception; fooled ones take words, orders, standing orders as that NPC's | minds.js:951-965; engine.js:2055 | `msg.deception`, `_vouched` | solid | rethink | Behaviour mark backed by a Deception total (kernel "Disguise and deception add marks"): fits exactly |
| Credibility | Stated certainty (sure/fairly/unsure/guess or 0-1) vs evidence-warranted (0.95 in sight ... 0 nothing); overselling >0.15 = bluff, Deception vs listener passive Insight; Persuasion raises trust; credence = p x (0.4+0.6 trust) x 0.8 if muffled | minds.js:825-887 | `CERTAINTY`, `warranted`, `believe` | solid, thoughtful, no trust meter by design | rethink | **No home yet** (kernel has no testimony weight / source credibility) |
| Claims (rumours) | Heard stories matched by content-word overlap; same story adds source not observation; relay vs independent; gullible count relays; "Now N goblins are telling the same story" | minds.js:748-780 | `m.claims[]` | hacky (word-overlap) but worked; v3 would replace with recognition | rethink | Testimony merge into individuals (v3 §2.6) |
| Orders | Down chain by rank; `received -> accepted/declined/superseded/failed`; ack travels back; same-issuer newer order doesn't silently cancel | minds.js:798-823, 1000-1100; brief ORDERS | `m.orders`, `m.issued` | solid; stale-order bug (fallback picked old order over Commander's) found in barracks | rethink (tasks) | **No home yet** (v3 §5 "orders as tasks") |
| Standing orders | hold-fire, engage, raise-alarm, pairs, hold-post, custom; classified from words by regex; adherence = .4 obedience + .35 authority + .25 loyalty; models take them via folded or split call; breaches are noticed by witnesses | minds.js:765-824, 1980-2052 `breach/witness`; think.js `takeOrders` | `m.standing[]`, `STANDING_WORDS` | half-built/hacky: regex classifier, `standingTake: "split"` extra model call, built late | rethink | **No home yet** |
| Talk menu | `mind <id> menu talk` / `act:{pick}`: engine suggests reachable people + how (where they are/were) so cheap models don't invent addresses | minds.js:1225-1345 `talkMenu/menuText` | | solid, born from model errors | rethink | Pointing + addressee resolution in observer's handles |
| Recognising comrades in dark | see 2.2 | | | solid | | |
| Calm lairs / superstition | `mindConfig.calm`: unknowns not shouted about, ceiling "curious", superstition scales vague sightings | minds.js:268-278; docs | | hacky tuning layer added after barracks false alarms | drop/rethink | disposition + stance; maybe arousal ceiling |

#### 2.6 Morale, rout, surrender

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| `morale` | DM rolls save per hostile mind (`all --dc 10`); failures rout | engine.js:1171; `next --auto` can run it | save from stats | solid (added after note 10: "Morale breaks don't move the minds") | as-is | Command; DM-owned judgement |
| Rout / surrender | `m.morale={state}` overrides plans; routed run to best exit (exits, named exits, else edge) away from enemies, shouting; no exit = cornered -> surrenders; `surrendered` condition | minds.js:1961-2013 | `s.exits`, places | solid | as-is | Stance + condition; exit scoring is pure geometry |
| Barks | `bark:true` dogs just bark instead of words | minds.js:2053 | | solid, tiny | as-is | |

#### 2.7 Briefs, models, decisions

| Feature | What it does | Where | Data it uses | State | Port | Fit |
|---|---|---|---|---|---|---|
| Brief | Text contract: identity+temperament, motivations, orders, command (rank>=3), standing orders, YOU (hp, alarm, senses), PEOPLE YOU KNOW, WHERE THINGS MIGHT BE (tracks + reachable regions), places, stories, 10 memory + 14 obs, beliefs, current plan + results, WHY YOU ARE THINKING, talk menu summary, local ASCII map (r=7 with places), doors, HOW TO ANSWER schema | minds.js:1355-1473 `brief` | built purely from mind | solid but **~126 lines, 4-6k tokens** (post-mortem); sections not stable across v2 ("contract" was v3) | rethink | `umwelt(who, focus)` rendered on demand; brief size is the main pain |
| Decision schema | One JSON: `version, beliefs, alarm, intention{objective,plan,reconsiderWhen}, now, say[], orders[], standing[], orderResponses, standingResponses, act, rationale` | minds.js:1491 `DECISION_HELP` | | solid | rethink | Agent reply: gist, actions, flag |
| Validation (`decide`) | Per-field accept/reject with reasons; cited-evidence check; alarm may rise freely, drop one step, never below sight; orders only to lower rank; steps checked (`checkStep`); rejected parts reported, valid kept; none valid -> still needs thought | minds.js:1733-1883, 1523-1561 | `ok[]/no[]` | solid, the best-validated piece | as-is | Command validation + rejection event |
| Stale detection | Decision made on older brief (obs.seq > version) keeps beliefs/plan, drops `now`; parallel thinks flagged `together` to skip | minds.js:1740 | `s.mseq` | solid | rethink | Kernel "stale briefs" flag (design already has it) |
| Forgiving fixes | Map mark -> track key, place name -> square, order under `say`, unstandable square -> nearest standable within 10 ft, unknown evidence ids dropped | minds.js:1562-1732 `lenient` | | hacky but valuable with cheap models; nearest-standable once sent a guard outside a wall (barracks) | rethink | Command normalisation layer, but beware engine guessing intent (v3 rule 2) |
| Plan execution | Engine runs each step with its own rules (pathing, doors, keys, action economy, attacks, 5-ft search); failures returned in non-leaky words ("the way is blocked") | engine.js ~1740-1900 | | solid | rethink | Timeline steps for NPC turns |
| Fallback policy | No model: fight what's in sight, warn once, investigate/hold by courage, follow accepted order, check noises if curious, else patrol/guard; officers hold; rebuilt on news; model plans persist | minds.js:1893-1960 `fallbackPlan`; 2057-2090 | | solid but hand-coded and tuned per encounter; stale-order bug | rethink | Routine-flag default agent (a cheap/rule policy); DM never woken for routine |
| OpenRouter thinking | Engine calls model itself in parallel for all minds with news; json mode; one retry with reasons (whole answer or plan-only); falls to fallback on any failure; menu follow-up call | lib/think.js:62-250 | `OPENROUTER_API_KEY`, `session_id` for caching | solid; ran the whole warren-caves fight on DeepSeek | as-is (concept) | Agent call infra; pre-think in background (API doc "Reactive minds") |
| Cost tracking | Per-model calls, prompt/completion/cached tokens, cost, ms | think.js `count`; `minds` output | `s.mindStats.usage` | solid for OpenRouter only; **none for Claude tiers** | as-is + extend | Journal `a4` agent-call lines |
| Claude-tier minds | `npc` agent (haiku/sonnet/opus) runs `mind <id> brief`, a hook blocks every other command, returns JSON, DM pipes to `decide` | .claude/agents/npc.md | | works, but DM loop cost (each NPC = spawn + paste) | rethink | Agent via kernel API, no DM relay |
| Party agents | `pc` agent: read-only `status/show/range/look`, returns SAYS/MOVE/ACTION/BONUS/WHY text; DM translates to commands | .claude/agents/pc.md | | works; free-text output parsed by the DM, not validated | rethink | Same agent-reply shape (gist/actions/flag) |
| Inspector | `mind <id>` shows tracks next to truth; `trace`; `brief`; `minds` queue table; `lastBriefText` stored | minds.js:2120-2160 | | solid; v3 wanted `attention`, `brief --explain` | rethink | `why`, `knows` queries |
| Time out of combat | `tick` = one 6 s round; each mind steps its plan; alarm cools; stops when someone sees an enemy and means to fight; low-urgency triggers go to fallback | engine.js:2014; minds.js:722 | `s.mtime` | solid | rethink | Game clock + scheduler; five kinds of time (kernel doc) |

---

### 3. Old mind data model (excerpts)

Mind record (`initMind`, minds.js:57-62):

```js
{ id, obs: [], memory: [], tracks: {}, beliefs: [], intentions: [], orders: [], pending: [],
  results: [], traces: [], alarm: {intensity:0, level:'routine', causes:[]}, warned:{}, checked:{}, doors:{},
  _known:{}, _fig:{}, _reported:{}, _smell:{}, kseq:0, patrolIdx:0,
  profile:{identity,role,faction,rank,tier,model,personality,competencies,senses,post,patrol,facing,fov,passive,knowsMap,home,bark},
  disposition:{vigilance,courage,obedience,curiosity,impulsiveness,sociability,superstition},
  motivations:[{id,description,priority,source,persistence}],
  roster:{id:{name,role,rank,post}}, relationships:{id:{trust,loyalty,authority,notes}} }
```

Track (a belief about something located; no entity id for strangers, `?3` for unclear figures):

```js
tr = { key:'x1', label:'a stranger with a shortbow (an intruder)', side:'hostile|neutral|ally|unknown',
       level:'identified|figure|movement', cell:'K9', t:12, direct:true, src:'saw it yourself',
       inView:true, kin:false, history:[{cell,t,via}], credence?, sources?, static?, downSeen?, searchedAt? }
```

Observation (what the model cites): `{id:'o17', t, seq, modality:'visual|auditory|tactile|special', kind:'sight|sound|lost|touch|scent|message|search', text, cell, region?, sig:0-3, alarmAdd?, subject}`.

Decision (what a model returns, `DECISION_HELP` minds.js:1491):

```json
{ "version": 41,
  "beliefs": [{"proposition":"...","confidence":0.6,"status":"hypothesis","evidence":["o12"],"where":"C3:F6"}],
  "alarm": "alert",
  "intention": {"objective":"...","priority":2,"plan":[{"do":"investigate","at":"C5"},{"do":"watch","at":"C5","rounds":2}],"reconsiderWhen":["..."]},
  "now": {"do":"say"...}, "say": [{"to":"all","channel":"shout","kind":"warning","text":"...","about":{"subject":"x1","at":"C5"},"certainty":"fairly sure"}],
  "orders": [{"to":"gob4","objective":"...","plan":[...]}], "standing": [...], "act": {"pick":"t1b","kind":"question","text":"..."},
  "rationale": "..." }
```

Brief section order (minds.js:1355+): header(version,time) / identity+temperament / MOTIVATIONS / ORDERS / YOUR COMMAND (rank>=3) / STANDING ORDERS / YOU / PEOPLE YOU KNOW / WHERE THINGS MIGHT BE / PLACES NEWS / STORIES / WHAT YOU HAVE PERCEIVED (10 memory + 14 obs) / BELIEFS / WHAT YOU ARE DOING / WHY YOU ARE THINKING NOW / talk menu / PLACES / MAP (r=7) / HOW TO ANSWER. Brief size from the post-mortem: ~126 lines for a busy goblin; OpenRouter session_id was used to keep the shared prefix cached.

Order: `{id, issuer, issuerLabel, issuedAt, status: received|accepted|declined|superseded|failed, objective, plan, at, authority, displaces:[ids], heard, expiresAt}`. Standing: `{ann, kind, text, adherence, issuer, issuerLabel, expiresAt, as}`.

---

### 4. Lessons for the kernel

#### Got right (keep)

- **Truth never reaches the model; the brief is rendered from the mind only.** Nothing in minds.js copies truth into a mind except via sense, message or an explicit `notice`. Differential "indistinguishable" tests were designed for it (v3 §2.4). The kernel's handle/observer rendering is the same stance, stronger.
- **Declare/validate/execute.** Models declare, `decide` accepts or rejects per field with reasons, the engine executes with its own rules. Partial acceptance (keep valid parts, retry only the lost plan) saved many calls (think.js retry logic). Keep as the command-validation layer.
- **Citable evidence ids.** Requiring beliefs to cite ids the mind actually has made hallucinated certainty detectable and became the model for kernel provenance (`why`).
- **A deterministic fallback so the world never stalls**, and a quiet-vs-loud trigger split (urgency threshold `deliberateAt`). Matches the kernel's routine flag that never wakes the DM.
- **Engine states deductions in words.** "By now it could have reached: ..." (reachable region) fixed the "last seen on the sand = is on the sand" model error. v3 rule 1; the kernel's `umwelt` should render derived facts, not leave inference to the model.
- **Clarity ladder + passive scores + per-observer hiding** are the design the kernel reading trees generalise.
- **Social mechanics worth keeping**: garble/voice-by-earshot-share, impersonation vs passive Perception, certainty vs warranted with bluff/Insight, speech-with-place-names-not-squares, rout/surrender with exit scoring, talk menu that constrains addressees.
- **Inspector next to truth** (`mind <id>`) was the main debugging tool; keep a DM-only "belief vs truth" view.
- **Cheap models can run NPCs.** DeepSeek v4 flash with reasoning off ran the warren-caves fight; "minds on OpenRouter models think on their own" was the best latency/cost lever. Claude tiers per NPC were much costlier in DM loop time than in tokens.

#### Got wrong (change)

- **Ad hoc knowledge records** (tracks, doors, claims, orders) built five times (v3 §2 table). Missing: absence ("Tobin is not on the sand"), items, task completion. Kernel individuals/traces fix this; make "expectation violated" a first-class reading.
- **Engine making judgement calls in deterministic clothes**: nearest-standable-square sent Tobin outside the wall; fallback followed a stale order; word-overlap claim matching; regex standing-order classifier; "kin" by size. Prefer models (or explicit DM rulings) for intent, engine for deduction.
- **Briefs as stored/regenerated text blobs** of 100+ lines, section shapes unstable, hard to debug. Render `umwelt` on demand with fixed sections and a size budget; offer `brief --explain`.
- **Mind edits only via full `setup`**, evidence not retractable, persona not live-editable. Needed: in-place edit of persona, motivations, relationships, rank, retract/override evidence, per-mind model, brief diff (rust-kernel-api P1 "Minds").
- **NPCs could not react in the moment**; replies were DM-written or forced `think`. Needs small reaction pass triggered by being addressed/urgent hearing.
- **DM as relay.** Claude-tier minds required the DM to spawn the agent and paste JSON back; each wake re-sent the whole transcript. Agents must be called by the server.
- **Morale and rout bolted on late** after a playtest showed failed saves changed nothing; keep it a first-class lever from the start.
- **Calm-lair/superstition tuning** is a patch layer to stop false stampedes caused by treating every vague sighting as a trigger. A salience/arousal model should absorb it.
- **Non-determinism**: `Math.random` for dice and sound blur; no replay (stealth.md "Not built"). Kernel dice-per-step already fixes this.
- **Cost accounting only for OpenRouter**; none for Claude-tier minds or the `pc` agent.
- **Free-text DM objects** (`describe`, `evidence`) with no tiers; kernel mark trees give them gates.
- **Hidden-flag duality** (`hidden` DM flag vs `hideState` per observer) produced special cases in `sightOf`, `search`, `scan`.

Playtest evidence: `docs/playtest-notes.md` (goblin-warren-caves: minds produced exploration -> alarm -> initiative on their own, which "worked"; note 10 morale; note 14/13 tracks/sound sources delivered), `docs/minds-v3.md` header (Greyhold Barracks failures: absence unnoticed, stale order, unstandable square, Dace "last seen on the sand" misread), `docs/rust-kernel-api.md` post-mortem (reactive minds, mind setup, noisy `[minds] will think...` output).

---

### 5. Gaps (old behaviour with no home in the kernel design yet)

1. **Alarm/arousal** state with levels, decay, ceilings, and the DM/party-visible cue (? ! on map). Kernel stance is a per-target attitude, not a per-mind activation state.
2. **Intentions/plans that persist across turns** (objective, step pointer, reconsiderWhen, results fed back) and an executor that runs plan steps each round; agent reply "actions" are single-turn.
3. **Orders and tasks** (issuer/assignee, accept/decline/supersede, expiry, precedence by rank/recency, completion), and **standing orders with adherence and breach witnessing**. Only mentioned as "groups ... orders" later.
4. **Credibility of testimony**: stated vs warranted certainty, bluffing vs passive Insight, Persuasion trust, certainty carried through relays, rumour merging and "N goblins telling the same story". Kernel says only "how much testimony can override what an NPC sees" (open question).
5. **Temperament** (vigilance, courage, obedience, sociability, superstition ...) that drives fallback and brief wording; kernel has dispositions toward identities, not personality.
6. **Trust/loyalty/authority relationship scalars** (stance has personal relation but no numeric dimensions).
7. **Fallback/default policy** for minded NPCs when no model is called (and DM-run "no mind" monsters). Needs an explicit per-creature-type policy (API doc P1).
8. **Out-of-combat time**: `tick`, cooling, patrol routes, posts, `deliberateAt`; stop-when-someone-sees-enemy rule feeding `initiative`.
9. **Sound propagation numbers and `noise`/footstep rules** (wall soak, hidden scuff gated by passive, loudness table, blur radius, sleep wake) as marks reaching hearing.
10. **Tracking trails** (decaying prints, ground DC, Survival tiers) and **evidence/clue search radius** (10 ft) as residual marks.
11. **Morale, rout (exit scoring), surrender, bark**, and the Wis-save `morale all --dc` lever.
12. **Places/landmarks vocabulary**: speech rewritten to names, `about.at` as pointing, brief map r=7 with place labels.
13. **Reachable-region deduction** ("where could it be by now") as a first-class umwelt derivation after contact is lost.
14. **Disguise noticing** (`disguise` + `disguiseDC` vs passive within 10 ft at clarity .8) and **impersonating a voice**: fits marks but the voice-known-by-whom rule needs a recognition model.
15. **Talk menu / addressee resolution** for weaker models, and the **forgiving decision fixes**.
16. **Model routing** (tier -> model, per-NPC override, provider order, session cache id, reasoning off), parallel think, retry with reasons, cost/latency/cached-token stats, API-key handling; plus the `npc`/`pc` agent contracts (restricted tools hook).
17. **Party view of NPC reactions**: chronicle lines only when the party sees the NPC; secret DM log otherwise; `perceivers` data for who heard.
18. **Group/roster-based starting knowledge** ("people you know", name vs face) is designed in v3 §2.5 but unbuilt in both worlds; kernel identities/groups cover the label but not the roster-fidelity idea.
19. **Consolidation/reflection** of old observations into lasting beliefs (v3 §8): deterministic truncation only in old engine; kernel short/long-term traces give a partial home.
20. **Differential "indistinguishable" tests** (two worlds with same evidence -> byte-identical brief): worth porting as a kernel test.

# Appendix D: Port survey: server, multiplayer, battlemap UI


Old tree: `C:\Users\Temho\tactical-dnd` (branch `codex/worldspace-orbs`). Kernel: `.claude/worktrees/rust-kernel`. Read-only survey; no engine/server was run. Line numbers are from the working tree as of 2026-10-23.

### 1. Summary

1. The old UI is one 2.9k-line `viewer.html` plus ~3.5k lines of `viewer/*.js` (3D map, wheel, markers, textures) behind a 636-line dependency-free `server.js` that shells out to `node engine.js` for every player button. The engine stays the only writer of state; the server is a thin referee plus a file-watcher that pushes a bare `change` ping over SSE.
2. The genuinely valuable, well-liked pieces are: the turn HUD with action/bonus/reaction pips and movement squares, click-to-move with route preview (jump/climb toggles, provokes-warning, second-click), the quiet/loud `auto` intent package, structured offers (incl. opportunity-attack offers), the inspect card (`/api/look`), the event-stream playback queue (n-numbered log, held positions, Skip), and the character builder.
3. The most elaborate part, the 3D map + pip wheel + worldspace orbs, is also the most experimental: the orbs are a visual-feel exercise ("not yet specified behavior"), the wheel solves a real problem (every action reachable with one click, costs greyed) but the user chose a floating-panel HUD plus wheel in parallel. Fog, chasm shading, sword flames, Swordsmith link and graphics presets are polish, not core.
4. The kernel already has the right protocol skeleton (`/commands`, `/messages`, `/wait`, `/stream`, per-observer rendering) but is missing everything player-facing past click-to-move and "Tell the DM": no seats/codes, no turn buttons, no offers, no inspect/`look`, no chronicle playback, no builder, no 3D.
5. Suggested first slice: keep the kernel's SVG map, add a turn HUD (pips + move squares + Dash/Disengage/Dodge/Attack/End turn buttons), offers dialog (Do it / Never mind, used for OAs), a click-for-card inspect panel, chronicle sidebar, and seat sign-in by word code. Defer 3D, wheel, orbs, builder, debug panel.

### 2. Feature tables

State key: **solid** = shipped, used in playtests, post-mortem says it worked; **hacky** = works with known workarounds; **half-built**; **experimental**.
Port key: **as-is** = port behavior and UI mostly unchanged; **rethink** = keep the need, change the design; **drop**.

#### 2a. Server, seats, sign-in

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Profiles + word codes | `register`/`login` by name+code ("ember-wolf-42", `WORDS` list); same code is the player's seat link and builder sign-in | `server.js:319-345`, `lib/chars.js`, `lib/core.js:69` (`normCode`) | `seats.json`, `characters/*.json` | solid (small, used) | as-is (simplified) | Kernel `seats` map already exists (`as=<seat>`); add `POST /login {code}` -> seat; codes minted by DM tool |
| Seats + join links | `engine seat <name> <id>` prints `/j/<code>`; redirects to `/play?seat=`; `local` token for the machine's own player | `server.js:99-106,375-381` | `C.seatByToken`, `C.loadSeats` | solid | as-is | Kernel `as=` query param; replace with token -> seat lookup |
| Brute-force lockout | 10 wrong codes per IP = 10 min lock | `server.js:86-97` | none | solid | as-is (cheap) | axum middleware |
| Tunnel / Tailscale awareness | Requests carrying proxy headers (`x-forwarded-for`, `tailscale-*`, `cf-connecting-ip`) count as non-local, so DM view is refused over a funnel | `server.js:190-195` | none | solid; handled a real bug class | as-is | Gate DM routes (`?as=dm`) on peer address + proxy headers. Kernel currently trusts `as=dm` from anyone. `--host` flag only affects printed links |
| DM view guard | `/api/state?view=dm` and `/api/log?view=dm` local-only | `server.js:383,411` | `isLocal` | solid | as-is | same as above |
| Gzip + `Cache-Control: no-store` | gzip over 1 KB (state shrinks ~5x over tunnels) | `server.js:180-189` | none | solid | as-is (tower-http compression) | axum layer |
| View cache | Cache player view body per state/log mtime (130 ms sight trace amortised) | `server.js:202-208,388-389` | stat of `state.json`/`log.jsonl` | hacky (file mtime) | rethink | Kernel renders per observer; cache per (observer, head step) |
| Rate limits | 150 ms act, 1.5 s intent, 600 ms ping, 5 chat/10 s | `server.js:489,590,548,572` | none | solid | as-is | per-seat limiter |
| Table chat | Player-to-player chat, never wakes DM, SSE `chat` event, 200-line `chat.jsonl` | `server.js:218-221,562-581`, `viewer.html:2897-2934` | `chat.jsonl` | solid (small) | as-is | `/chat` + `chat` SSE event; keep out of inbox |
| Pings | Short-lived marker with name drawn on everyone's map (key `P`); not stored | `server.js:539-561`, `viewer.html:2643-2690` | `C.partyKnows` (don't leak hidden creature names) | solid | as-is | transient SSE event `ping {who, cell, z, label}`; label resolved per recipient |
| Connection chip | Dot + RTT, green<100 ms, amber<300, red; loss glyph when stream down | `viewer.html:2871-2895`, `server.js:537` | `/api/ping` | solid | as-is | cheap `/ping`; chip reads SSE state |
| SSE `change` + 20 s keepalive | File watcher (200 ms poll) pushes `data: change`; viewer refetches everything. Also `ping`, `chat` events | `server.js:609-629`, `viewer.html:2905-2910` | `watchFile` on state/log/intents | hacky: refetch-everything, no payload, `EventSource` reconnect was "unverified" in HANDOFF | rethink | Kernel `/stream` carries steps. Viewer should apply steps, resync on `reset` |
| Stale-action stamp (409) | Every act/path carries last-seen log `n` and `game` id; server refuses with `{stale:true}` if a move/turn/terrain/damage/attack entry came since | `server.js:196-216`, `viewer.html:1589` | log line numbers | solid, born of Card 13c | rethink | Kernel steps have ids: send `since_step`, server refuses if intervening step touched actor/board |
| Engine-queue serialisation | All player button commands run through `execFile engine.js` serially | `server.js:113-124` | node startup per call (the post-mortem's latency complaint) | hacky | drop | Direct in-process command call; kernel already does |

#### 2b. Intents, replies, `did:` packages, offers

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Intent (free text to DM) | Player types action, optionally with a pointed target/cell+z and `spend` (marks action/bonus/reaction used immediately); instant receipt telling whether DM is listening | `server.js:582-608`, `viewer.html:1306-1336` | `intents.jsonl`, `C.dmPresence`, engine `use` | solid | as-is | Kernel `POST /messages {as,text,at}` already acks. Add `spend`, `kind: inspect`, `target/cell/z` |
| Message status | `sent` -> `DM has it` -> `answered` + DM line -> `done check`; viewer shows last 8 | `server.js:428-429`, `docs/multiplayer.md:38-45`, `viewer.html:1185` | `listen`/`wait`/`reply` | solid | as-is | Kernel has `messages`, `reply`, `seen` equivalents (HANDOFF: inbox with instant acks) |
| DM presence light | "DM listening / DM busy" from `listening.json` heartbeat | `lib/core.js:118`, `viewer.html` (`#pres`) | `markListening` | solid | as-is | `wait` blocking marks listening; expose in `/messages` |
| Quiet vs loud `auto` intents | Buttons run engine cmds and file the result as an `auto` intent. Quiet (plain move, dash, dodge, undo) never wake the DM; loud (attack, check, hide roll, athletics/provoke/fall moves, End turn) do, carrying the quiet pile | `server.js:125-178,508-511`, `docs/multiplayer.md:79-81` | `await`/`listen` wake rules | solid; was the cure for post-mortem item #1 ("dozens of wakes were quiet End turn presses") | as-is | **Kernel gap**: HANDOFF lists "quiet/loud messages" as follow-up. Needs `quiet` flag on inbox items and `dm wait` that batches them |
| Offers + dialog | DM or engine files an offer with terms; player gets Do it / Never mind (or Roll it with skill+DC); yes runs the engine ruling/`oa` and wakes DM | `server.js:58-74,431-432`, `viewer.html:2369-2400` | `offer` cmd, `offers.jsonl`, `ruling` | solid | as-is | Kernel gap: needs `offer` table + `POST /offers/{id}/answer`; answers return structured to DM wake bundle (post-mortem P0) |
| Opportunity-attack offers | Monster leaves reach of a seated PC with reaction: engine records `pendingOA`, offers "Opportunity attack with Longsword?"; yes rolls it from departure cell, no drops; lapses after 2 turns | `docs/multiplayer.md:86-94`, `server.js:63-65,430` | `oa <id>`, `pendingOA` | solid (HANDOFF note 17 done) | as-is | Same offer mechanism, kind=`oa`. Reaction pip stays visible off-turn |
| Seated/explore mode | Before initiative (encounter loaded, no turn order) each seated creature can act one round at a time; Ready = "let a round pass"; attack just tells DM | `server.js:36-57,160-171` | `turnInfo` | solid | as-is | Kernel: same UI state when no initiative |
| Remote-player await loop | `await` blocks until intent / loud action / seated turn ends | CLAUDE.md, `engine.js` | | solid, but cost 4-6 tool calls per message | rethink | Kernel `/wait` + context bundle (already built) |
| Receipt text | "Delivered. DM is listening… It's X's turn so this is noted as your plan." | `server.js:76-85` | | solid | as-is | cheap string in `post_message` |

#### 2c. Turn buttons and movement

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Turn tracker (`turn` in `/api/seat`) | Pips for action/bonus/reaction, movement left, features (Cunning Action etc.), `canUndo`, `undoCost`, Hide preview | `server.js:26-33,423-442` | `turnInfo`, `featuresOf`, `hidePreview`, `undoCost` | solid | as-is | `GET /rooms/{id}?as=` view gains `turn{used,left,dash,features,canUndo}` |
| Move + route preview | Hover cell -> route (cost, dashLeft, DC checks, provokers) -> "Move here 25 ft"; second click on provoking route; jump/climb-fast toggles | `server.js:462-483`, `viewer.html:1667-1714,2006-2083` | `findPath`, `provokersAlong`, `lib/grid.js` shared with browser | solid; 13c moved pathing client-side so wheel opens in ~1 ms | rethink | Kernel already has dry-run route preview on `/commands`. Needs: jump/climb flags, `provokers`, `checks`, DC list. Don't copy the client-side path module unless latency demands |
| Dash / Disengage | Costs action, or bonus with Cunning Action / Nimble Escape (`as: bonus`) | `server.js:128-129,172-178` | `featuresOf` | solid | as-is | commands + economy check in server |
| Dodge | action | `server.js:130` | | solid | as-is | |
| Hide | `hide --auto` rolls Stealth vs all enemies who could see, reports who'd notice; preview before commit | `server.js:131-135`, `lib/minds.js hidePreview` | perception | solid | rethink | Kernel perception design (marks/readings) replaces this; preview via dry-run |
| Undo move | Reverts plain moves before acting; restores hiding; `undoCost` says what a second look would reveal | `server.js:144`, `docs/playtest-notes.md` #7 | engine `undo` snapshots | solid | rethink | Kernel timeline/`rewind` covers it; needs a per-turn "undo last move" shortcut and a cost preview |
| Attack (from card) | `attack id target weapon [--sneak]`, economy-checked by weapon `as` | `server.js:136-142`, `viewer.html:1715-1789` | `findAttack`, `look.attacks` | solid | as-is | `attack` command plus per-target odds from `look` |
| Skill check | Skill picker on the inspect card; `check skill --about` | `server.js:143`, `viewer.html:1749` | | solid | as-is | |
| Doors | open/close/lock/unlock beside the door (free interaction); `locked` known only after you hold its key or try | `server.js:146-157,399-401` | `walls[]` with ids | solid | as-is | needs a door entity/handle in kernel view |
| End turn | `next --by-player`; engine refuses to end a seated turn otherwise; unused-action second click | `server.js:158`, `viewer.html` (`secondClick`) | | solid | as-is | |
| Second-click confirm | In-card "Provokes gob1. Click again to move." replacing native `confirm()` | `viewer.html:1574-1586` | | solid (Card 1) | as-is | |
| Wheel slot swaps | `POST /api/wheel` stores signature/kit slot choice on the character | `server.js:444-459` | `Chars.setWheel` | half-built (viewer uses localStorage `slotPref`; builder step exists) | rethink | See 2f |

#### 2d. Inspect, look, describe, sidebar, chronicle

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Inspect card / cursor | Square or Entity mode, arrows move, `[` `]` height, Esc clears. Card shows what your character can tell: health words, conditions, footing, distance incl. height, LOS, cover, which attacks reach and odds, path cost, DM `describe` facts | `server.js:516-535`, `lib/core.js:418 look`, `viewer.html:1337-1546` | `C.look`, `describe` | solid (Card 4 "fixed entity card" done) | as-is | Kernel: `GET /look?as=&at=` rendered through the observer's marks (perception doc step 4 `umwelt`/`knows`) |
| Hover chip | "65% - 30 ft - 1/2 cover" over tokens | `viewer.html:1432-1476` | `/api/look`, hoverCache | solid | as-is | same endpoint, cached per head step |
| Ask (inspect intent) | Private question to DM; DM answers with `reply`, lasting facts with `describe` | `server.js:597`, `viewer.html:1503` | | solid | as-is | message `kind: inspect`; `describe` = a mark/fact on entity or cell in kernel |
| Pointing rides along | `target` or `cell+z` sent with next intent | `server.js:602-603`, `viewer.html:1343-1352` | | solid | as-is | Kernel `/messages {at}` already does; page has "pointing" row |
| Chronicle (sidebar log) | Story / Details tabs, perceiver portraits, mechanics chips, entries become clickable links to creatures/cells; scroll-back via `/api/log?before=` | `server.js:410-422`, `viewer.html:1004-1169` | `logFor`, publicLog hiding | solid | rethink | Kernel step log per observer with `summary`; keep Story/Details split and links |
| Sidebar panels | Collapsible story panel, initiative bar, character sheet tab, DM resolving strip | `viewer.html:451-560` | | solid | as-is | |
| Character sheet tab | Full sheet next to log | `viewer.html:1273-1305` | builder char | solid | as-is | |
| Table chat | see 2a | | | | | |
| DM toggle (`?dm`) | Spoiler view of everything; hidden creatures, notes | `server.js:383`, `viewer.html:581-585` | | solid | as-is | `?as=dm` already there |

#### 2e. Playback (event stream)

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Sequence numbers + `game` id | `n` = log line; viewer resets on game change | `docs/card6-event-stream.md` | | solid (6a/6b done; "unverified: EventSource reconnect") | rethink | Kernel step ids and `reset` event replace it |
| Ordered playback queue | One queue: glide/hop -> trail -> dice -> ticker -> log line; held positions at move start; catch-up to current turn after tab hidden or >8 s backlog; Skip to now; speed 1/2x-4x | `viewer.html:2401-2535`, spec above | log entries with `data.path` and roll data | solid, user-requested ("Turn feel") | as-is (concept) | Kernel `step` events must carry `path`, rolls (d20 + mods), damage numbers so the viewer can animate; the stream `since` resume covers catch-up |
| Dice tray / hit fx | d20 lands, shot flies by damage type (`SHOT_LOOK` 3D, `shoot2d`), target flashes, damage rises | `viewer.html:2553-2634` | roll data per entry | solid, liked | as-is | roll data in step outputs |
| Action ticker, DM resolving strip | One-line ticker; "DM is resolving..." from presence | `viewer.html:2401,2635` | | solid | as-is | |

#### 2f. Map rendering, camera, fog, wheel, orbs

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| 2D SVG map | Terrain, walls, doors, tokens (initials), HP, effects, trail, fog rects, path line, pan/zoom (`wirePanZoom`), `Fit`, `focusRef` zoom-to-object by size | `viewer.html:612-960` | view JSON (cells with `fog`, `h`, `obj`, walls) | solid; the default (3D is `?3d`) | as-is | Kernel page is the same idea at 256 lines; add pan/zoom, walls/doors, height badge (`N5@10ft`), fog |
| 3D map (three.js 0.160 via CDN) | Bodies by side/armour, flat checker floor, walls fade, chasm depth, fog field, glide/shoot/bump/hit fx, turn-follow camera | `viewer/map3d.js` (1978 lines) | CDN, `state` | experimental-but-extensive; loved: checker floor, full-window overlay layout; fog rework merged (`154c6f2`), 14c-14e not started | rethink | A second renderer over the same view JSON. Needs 3D visibility (z), tags like `hang-n` for bridges. Biggest port cost, lowest necessity |
| Camera controls | 2D: wheel zoom, drag pan. 3D: LMB drag ground, RMB orbit, wheel zoom, MMB dolly, WASD pan, Reset view, Follow turn (eases to active creature, yields on input), Low walls | `viewer.html:738-760`, `viewer/map3d.js:1490+`, HANDOFF 7,13a | | solid | as-is | pure client |
| Fog modes | `unknown` (black) / `remembered` (dimmed, not live) / `visible`; `fog off` makes all visible (DM tool); 3D adds a soft fog field with chasm gradient; Debug toggles | `lib/core.js:176-186`, `viewer.html:652,805-860`, `map3d.js:252-304` | explored set per party | solid (2D), hacky/perf-heavy until 14b rework | rethink | Kernel observers' per-creature perception already yield visible/remembered; viewer renders. Do the 2D version only |
| Pip wheel | Hexagonal 6-slot ring around a clicked target (enemy / ally / self / square / door / pick-wheel). Slot 1 smart (Strike, Aid, Move here); Signature/Kit/Tactics sub-menus; keys 1-6; right-click alternates; every leaf gated by its action cost; second click on provoking route | `viewer/pip-wheel.js` (380), `viewer.html:1789-2370`, `docs/card5-wheel.md`, `docs/wheel-lexicon.md` | `/api/look`, `act`, `postIntent`, `Chars.wheelOf` | half-built: Card 5a/5b done; HANDOFF lists a long "unverified in visible window" list; leaves are mostly intents (DM rules) not engine commands | rethink | The need (one click -> any legal action, greyed with reason) is real. Keep as an *optional* radial; kernel must publish "what can X do to Y" (legal actions + costs + odds) so wheel/HUD/card all read one list |
| 3D wheel, marks, stems | Wheel unfolds out of creature icon; stems and icon-mode for crowded squares; hover by screen-space ellipse | `viewer/wheel3d.js` (274), `viewer/marks3d.js` (390), `docs/port-wheel3d.md` | map3d | experimental; user preferred `poc/wheel3d.html` feel | drop (for now) | |
| Worldspace orbs | Action orbs as little 3D spheres with extruded glyphs, depth-stippled captions, bob/proximity easing, orbit; share visual language with future "unactualised item orbs" | `viewer/orb-glyph.js`, `orb-label.js`, `docs/worldspace-orbs.md`, `docs/orb-feel-notes.md` | wheel3d | experimental: "design ideas, not yet specified"; stress test "has not yet been run" | drop | |
| Sword art / Swordsmith / Paladin demo | Compiled 3D sword on orbs and held weapon; flame styles; `/swordsmith/*` workshop pages | `viewer/sword-art.js`, `sword-preview.js`, `paladin-demo.js`, `tools/sword-icons/` | | experimental side project, untracked files | drop | |
| Debug panel | Graphics quality/fps/sharpness, fog/chasm shading toggles, fps chip, orb rotation sliders | `viewer.html:479-498` | | experimental | drop (keep fps chip idea) | |
| Textures | Seeded procedural canvas textures; later superseded by flat checker | `viewer/textures.js` | | superseded (`TEXTURED=false`) | drop | |
| Barracks props | Crates/barrels as meshes | `viewer/barracks-props.js` | | half-built (14c: props as selectable entities not done) | drop | |

#### 2g. Home page and character builder

| Feature | What it does | Where | Depends on | State | Port | Fit |
|---|---|---|---|---|---|---|
| Home / sign-in | Name + code, lists your characters, the running game and your seat link | `home.html` (233), `server.js:247-257,300-345` | `Chars`, `loadSeats` | solid | rethink | Reduce to "pick seat, open map" first |
| Builder (`/build`) | Step nav: Concept, Species, Class, Background, Abilities (point buy / roll / manual), Feats, Spells, Gear, Homebrew, Wheel, Finish; live sheet; defaults from `recommend` | `builder.html` (879), `lib/rules.js` (1569), `docs/character-builder.md` | rules tables | solid; own tests in `test.js` (starter party matches hand sheets; every class/subclass at 1,3,5,11,20) | rethink | Needs a Rust rules/data layer. Choices -> derived stat block is the contract; builder can stay JS talking to a `/api/char` that the kernel serves |
| Character API | `POST /api/char {action: new/save/delete/recommend/roll-abilities/roll-hp/use-homebrew/send-homebrew/ask/suggestion}`; `GET /api/char?id` | `server.js:258-285,351-366` | `Chars.*` (`lib/chars.js` 255) | solid | rethink | Port data model (`characters/<id>.json` = choices only); validation server-side |
| Suggestions | DM `suggest <id> --patch` shows gold highlights, Accept/Decline/Talk; thread via `char reply` | `docs/character-builder.md` | | solid | rethink | Kernel message thread kind `builder:<id>` |
| Homebrew power rating | Feat-point yardstick, `lib/power.js` KINDS vocabulary, creep allowance, benchmarks vs official content | `lib/power.js` (256), `docs/character-builder.md:42-79` | | solid, tested; clever but heavy | rethink | Port only if homebrew stays a goal; else drop |
| `char spawn <cell>` | Brings a finished character into the encounter, seated to owner | CLAUDE.md | | solid | as-is | kernel `spawn` from a char file |

### 3. Protocol

#### Old server (`server.js`)

| Route | Shape | Notes |
|---|---|---|
| `GET /` `/play` `/build` `/j/<code>` | HTML; `/j/` 302s to `/play?seat=<code>` | |
| `GET /api/state?view=player\|dm` | Full view JSON: `{name, round, width, height, cells[][], creatures{}, walls[], turnOrder, current, log[last 80], game, seq, ...}` | Cached per file mtime; includes per-creature `wheel` and `keys`. Refetched on every SSE `change` |
| `GET /api/log?view&before=n&limit` | `{game, log}` filtered like the window | scroll-back |
| `GET /api/seat?token=` | `{player, creatures, wheels, intents[<=8], offers[<=3], reactions{id:bool}, turn, explore, dm:{listening}}` | heavy parts cached |
| `GET /api/path?token&id&cell&n&game&jump&fastClimb` | `{ok,cost,left,dashLeft,path[],checks[{kind,dc,to}],provokers[]}` or `{ok:false,reason}`; 409 `{stale}` | read-only |
| `POST /api/act {token,action,id?,n,game,...}` | actions: `move{cell,jump,fastClimb}`, `dash{as}`, `disengage{as}`, `dodge`, `hide{as}`, `attack{target,weapon,sneak}`, `check{skill,about}`, `undo`, `door{door,op}`, `end`, `answer{offer,accept}` -> `{ok,text,quiet}` | runs `node engine.js ...`, files an `auto` intent |
| `POST /api/intent {token,text,kind?,creature?,target\|cell+z,spend?}` | -> intent entry + `receipt` | 600 chars, sanitised |
| `GET /api/look?token&from&id\|cell&z` | inspect card | |
| `POST /api/ping`, `POST /api/chat`, `GET /api/chat` | transient / log | |
| `POST /api/wheel {token,id,slot,name}` | store wheel slot choice | |
| `/api/login /register /me /game /char` | profile + builder | |
| `GET /events` (SSE) | `data: change` (all files), `event: ping`, `event: chat`, `: ping` every 20 s | no payload; clients refetch |

Engine-side files: `state.json`, `log.jsonl`, `intents.jsonl`, `offers.jsonl`, `seats.json`, `listening.json`, `chat.jsonl`, `characters/*.json`.

#### Kernel (`kernel/crates/server/src/main.rs`)

`/api/rooms`, `/rooms/{id}?as`, `POST /commands {as,gist,commands,dry_run}` -> one step, `/history`, `/stream?as&since` (SSE: missed steps then live; `reset`; `notice` for seat messages), `POST/GET /messages`, `POST /messages/{n}/reply`, `GET /wait?timeout` (batched wake + context bundle), `/pending`, `/stats`, `/journal`, `/review`, surgery/branches/rewind. Everything per observer, in the observer's names; static `kernel/web`.

#### Comparison

| Concern | Old | Kernel | Gap |
|---|---|---|---|
| Push | bare `change`, viewer refetches 130 ms+ view | steps over SSE with `since` resume and `reset` | viewer must fold steps; ordered playback comes nearly free |
| Auth | token in query -> seat; `local` for DM machine; lockout | `as=` name, unauthenticated | seat codes, DM-only gating, lockout |
| Player buttons | `/api/act` shells to engine, files `auto` intents | `/commands` is the only write | economy checks + quiet/loud wrapper; `act` on behalf of current creature |
| Route preview | `/api/path` + client-side `lib/grid.js` | `/commands dry_run` | add checks/provokers/dashLeft |
| Offers | `offers.jsonl` + `answer` action | none | add `offers` + answer endpoint, delivered as structured item to DM |
| Quiet/loud | `quiet` flag on auto intent | not yet (HANDOFF follow-up) | add |
| Look/inspect | `/api/look` | none (title tooltip only) | add `/look?as&at` |
| Chat / ping | SSE events | none | add |
| Chronicle | `log` window + `before` | `/history?as&limit` | add `n`-style scroll-back, Story/Details classification |
| Builder | `/api/char` | none | port or defer |
| Stale check | `n`+`game` stamp | step ids | `since_step` on commands |

### 4. UI worth keeping

Roughly in order of value; screenshot: `docs/screenshots/card-1-confirmation.png` (the only image in the repo: 2D map, turn card with pips and Dash/Disengage/Dodge/Hide/End turn, square card with jump/climb toggles, provokes second-click, "Move here 5 ft", Ask the DM, and "Your turn" compose box with "Pointing at I4").

1. **Turn HUD** (`viewer.html:1604-1666`, "docked bottom-left"): HP ring, action/bonus/reaction pips, movement as 5-ft squares, resources, buttons, tmsg line. Needs: `turn` block per seat creature in the view; economy errors as text. Used every turn.
2. **Route preview and move** with provoke warning, jump/climb toggles, "Dash & move" fallback when only a dash reaches. Needs: dry-run result with `cost`, `left`, `dashLeft`, `checks`, `provokers`, DC text.
3. **Offers dialog** (`#offerSec`, `viewer.html:2369`): small, huge value because it turns DM chatter into one click. Needs: offer record `{id, creature, text, ruling?|oa?}` and answer endpoint; OA offers fed from the move step.
4. **Inspect card + cursor**: "what my character can tell" including attack odds and path cost. Needs: kernel `look(observer, target)`.
5. **Quiet/loud package** and message states ("sent / DM has it / answered / done"), plus DM presence light. Needs: `quiet` bit on inbox items.
6. **Playback**: ordered queue, held positions, dice/hit fx, Skip, speed. Players praised "turn feel" and the dice. Needs: steps carry `path`, rolls, damage.
7. **Chronicle** with Story/Details, perceiver portraits and clickable names (also the kernel's planned step 8).
8. **Pings, table chat, connection chip**: tiny, cheap, loved at the table.
9. **Full-window map with floating panels and collapsible side**: user: "I like this so much better". Pure layout CSS.
10. **Initiative bar** (portraits, hidden/down state, `?` for unseen) (`viewer.html:966-1003`).
11. **Pip wheel** (as an optional radial) and **builder** are high value but high cost; see "Suggested minimal slice" for when.

Not worth porting yet: worldspace orbs, sword art/Swordsmith, debug panel, graphics presets, textures, paladin demo, 3D stems/icon mode.

### 5. Suggested minimal slice (small skirmish, ~one session of UI work)

**Server additions** (kernel): seat codes (`POST /login`, token -> seat, `as=dm` only from local), `GET /rooms/{id}?as` with a `turn` block (pips, `left`, `canUndo`), `POST /act` thin wrapper that checks the action economy and calls `/commands` with a `quiet` flag, `offers` (`POST /offers/{id}/answer`) with OA offers emitted when a non-party move leaves reach, `GET /look?as&at`, `chat` and `ping` SSE events, `/ping` for the chip. Add `since_step` staleness to `/commands`.

**Page** (extend `kernel/web/index.html`; keep SVG):
1. Turn HUD: pips, movement squares, buttons **Move (existing click), Dash, Disengage, Dodge, Attack (on a selected target), End turn**. Hide and Skill check second.
2. Route preview with cost, provokes, jump/climb checkboxes.
3. **Offers dialog** (Do it / Never mind) for opportunity attacks and DM terms.
4. Click a token/cell -> inspect card (health words, distance, cover, attack odds, Ask).
5. Chronicle sidebar with Story/Details; dice/hit toast per step (no animation queue yet; later add playback from `step` events).
6. Initiative bar and DM presence light; keep "Tell the DM" box.
7. Then: pan/zoom + fog (unknown/remembered), pings, chat, connection chip.

**Defer**: 3D, wheel (add after buttons exist, reading the same "legal actions" list), orbs/swords, builder (hand-author characters at first; port builder once class tables exist in Rust), debug panel.

### Appendix: how the DM uses the UI

The DM is Claude Code, not a browser user. It watches `await`/`intents` (old) or `dm wait` (kernel). The only DM-facing UI is `?dm` (spoiler map, local-only), `reply` lines that show under the player's message, and `describe` facts on inspect cards. The old `/play?dm` view and the "DM is resolving..." strip are what the table sees of the DM's work. Post-mortem (`docs/rust-kernel-api.md`) says the cost was in message loop wakes and CLI start-up, not in UI.
