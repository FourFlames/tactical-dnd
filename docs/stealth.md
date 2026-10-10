# NPC minds: situated stealth

Guards who only know what they've seen, heard, smelled or been told; who talk to each other, take (or refuse) orders, get distracted, and calm down again. Stealth becomes a contest over **information**: what each NPC knows, believes, and passes on.

Code: `lib/minds.js` (perception, knowledge, alarm, speech, briefs, decisions, fallback policy), engine commands in `engine.js`, the `npc` subagent in `.claude/agents/npc.md`, tests in `test-minds.js`. Try it with `node engine.js load tollhouse`.

## Three worlds

- **Objective:** `state.creatures`, walls, light. Only the engine changes it.
- **Subjective:** `state.minds[id]`, one per NPC: observations (its evidence, with ids), tracks (where it thinks things are, and why), beliefs, alarm, orders, intentions.
- **Intended:** each mind's current intention and plan, executed by the engine step by step.

Perception connects the first to the second after **every** state-changing engine command. A model connects the second to the third. Speech connects minds to each other without making them the same.

## Perception (deterministic)

| Sense | Rules |
|---|---|
| Sight | Line of sight (3D, walls, props) · light at the target: encounter `lighting` {ambient, areas}, cell tags `lit`/`dim`/`dark`, torches (`light: <ft>` on a creature), fires · darkvision raises one step · facing: 110° each side seen, past 60° only peripheral, unless alert/in combat or `fov: "all"` · distance and cover blur it. Clarity ≥ .65 identifies, ≥ .35 is "an unidentified figure", less is "movement". |
| Stealth | A hidden creature (`sneak`, which stores its Stealth total) is noticed only by passive Perception ≥ that total (−5 in dim light or at the edge of vision). It can't hide in plain sight: bright light, no cover, within 30 ft, looked at directly. Being noticed as a figure or better ends hiding. |
| Hearing | Every sound has an origin and a loudness in feet; walls soak 30 ft, closed doors 20, windows 10. A listener gets a direction, a rough distance and a blurred square, never a name. Footsteps 30 ft (60 for `noisy`, e.g. chain mail), a hidden mover's scuff 15 ft and only for passive ≥ their Stealth, a fight 90, a bowstring 20, `noise` whatever you set. Footsteps where a comrade is known to be are ignored. |
| Touch | Being attacked or hurt, with the direction it came from. |
| Special | `senses: {darkvision, blindsight, scent, keen, keenHearing}`. Scent notices a stranger within range through walls, without saying who. |
| Doors | A guard who sees a door notices if it's not how they last saw it. |
| Sleep | `asleep` can't see; hears at half range; a sound wakes them. |

Observations never include what wasn't perceptible: an unidentified figure stays `?3`, a sound is a sound. Identified intruders get an opaque key (`x1`), never their name. Allies are known by name (the NPC's `roster`) but their positions only by sight or report.

**Losing contact:** when a tracked figure goes out of view the track keeps the last *seen* square and time. The brief turns that into a region it could be in now (pathing from there at 30 ft/round, doors included), with the cover in it. That's what searches are planned against.

## Speech and command

Speech is a world event (`whisper` 5 ft, `speech` 30, `shout` 150, `signal` needs line of sight). Everyone in earshot hears it, **including the party**: overheard lines go to the chronicle. A recipient gets a message observation with the sender as they know them ("Bram", or "an unseen voice to the west") and, if it was about something, a *reported* track: `direct: false`, labelled with who said so, plus the chain if the sender was passing on a report. Two contradictory reports stay as two tracks.

Orders go only down the chain of command (`rank`), by voice or signal. They arrive as `received`. The recipient accepts or declines (its decision, or the fallback by `obedience`), and the acknowledgement travels back the same way. Gag the sentry and nobody hears the warning.

## Alarm

`intensity` 0–100 with levels `routine` (0), `curious` (15), `alert` (40), `combat` (70). Observations bump it by significance × vigilance. An armed intruder clearly in sight within 60 ft means combat. It cools every round with no news (faster for the less vigilant), and a fruitless search cools it more. Alert and combat NPCs look all around. When the party can see an NPC, its level shows on the map (`?` / `!` / red `!`) and the change is narrated ("Bram stops and peers toward the east"). Otherwise it goes to the DM log only. Unseen NPC moves go to the DM log too.

## Deliberation: who thinks, and with what

Each perception adds triggers (`pending`, urgency 1–3) to the minds it touched. **Nothing calls a model automatically.** The DM decides, guided by `minds`:

```
node engine.js minds                        # who needs thought, with which model
node engine.js mind bram brief              # what the npc agent reads (it fetches this itself)
node engine.js mind bram decide --file -    # paste the agent's JSON (or decide '<json>')
node engine.js mind bram fallback           # or: no model, deterministic plan
```

Model routing is by `tier`: `minion` → haiku, `elite` → sonnet, `commander` → opus (override per NPC with `model`, or per encounter in `mindConfig.models`). Call the `npc` agent with that model. It can run exactly one command, `node engine.js mind <id> brief` (a hook blocks anything else), so it can't read the state, the map or the DM's notes.

The brief holds identity, temperament, motivations, orders, condition, alarm, the people they know, tracks with reachable regions and history, recent evidence with ids, beliefs, the current plan and its results, why they're thinking, the map as they know it (doors as last seen), and the answer format.

The decision is one JSON object: `beliefs` (must cite evidence ids it has), `alarm` (may raise freely, lower one step, never below what's in sight), `intention` {objective, plan, reconsiderWhen}, `now` (one step first), `say`, `orders` (subordinates only), `orderResponses`, `rationale`. **Every part is validated.** Unknown ids, uncited evidence, orders up the chain, illegal steps and bad squares are rejected with reasons and the valid parts are kept. If nothing passes, the NPC still needs thought. A decision made against an older brief (new evidence arrived meanwhile) keeps beliefs and plan but drops `now`. Everything lands in `mind <id> trace` and the DM log.

Plan steps: `move`, `flee`, `guard`, `patrol`, `watch`, `investigate` (go there and search: a Perception roll against anything hidden within 10 ft), `attack` (only something in sight), `follow`, `say`, `door`, `hide`, `wait`. The engine executes them with its own rules: pathing (opening doors it may open; keys in `keys: [...]`), movement budget, action economy, attack rolls. Failures come back to the NPC without saying why in ways it couldn't know ("the way is blocked").

**Fallback policy:** with no model consulted, an NPC still acts sensibly from its own knowledge. It fights what's in sight, warns others of what it saw (once), investigates or holds depending on courage, follows accepted orders, checks out recent noises if curious (or just watches if not), and otherwise patrols or guards its post. Officers (rank 3+) hold and wait for reports. Fallback plans rebuild whenever there's news. A model's plan stands until it's done or fails.

## Time

- **Out of combat:** players move, then the DM runs `tick` (one round, 6 seconds). Every mind takes one turn of its plan, alarm cools, movement budgets reset. Triggers below `mindConfig.deliberateAt` (default 2) are handled by the fallback and cleared; higher ones wait for the DM. `tick` stops when someone can see an enemy and means to fight: roll `initiative`.
- **In combat:** on an NPC's turn, deliberate if `minds` says so, then `mind <id> act`.

## Player tools

`sneak <id>` (Stealth roll; `--total N` for a roll made elsewhere) · `noise <cell> "..." [--loud ft]` (distractions: a thrown stone turns heads and draws the curious) · `door <id> open|close --by <id>` (doors make noise; an open door gets noticed) · ordinary moves (heavy armour is loud). Rulings that the engine doesn't model can still reach NPCs through `mind <id> notice "..."`: the smell of smoke, a missing ledger.

## Authoring an encounter

Give any creature a `mind` block (everything optional):

```json
"mind": {
  "role": "door guard", "faction": "the Toll Watch", "rank": 1, "tier": "minion",
  "post": "G11", "facing": "S", "patrol": ["S1", "B1"], "fov": "cone",
  "personality": ["Bored, cold."], "senses": {"darkvision": 60},
  "disposition": {"vigilance": 0.4, "courage": 0.5, "obedience": 0.7, "curiosity": 0.4, "impulsiveness": 0.4, "sociability": 0.6},
  "motivations": ["Keep anyone from walking in the front door."],
  "relationships": {"bram": {"trust": 0.3}}, "bark": false
}
```

Plus `lighting` on the encounter and `light`, `noisy`, `descr` (what NPCs see), `disguise` / `disguiseDC`, `keys` on creatures. `mind <id> setup '<json>'` adds a mind mid-game.

## Not built yet

- Batching several minions into one model call, token and cost accounting (`minds` counts deliberations per tier, accepted and rejected parts, stale decisions and fallbacks, but not tokens), latency budgets.
- Seeded dice and full deterministic replay. Decisions are recorded in traces and the log, but the engine's dice use `Math.random`.
- Model-assisted memory consolidation. Old observations roll into a memory list deterministically, keeping their ids.
- A cognition overlay in the viewer. The inspector is `mind <id>` in the terminal: each track next to the truth.
- Rich sound propagation (around corners, along corridors). It's a straight line with wall penalties.

## Calm lairs and superstition

Set `"mindConfig": {"calm": true}` for an encounter where NPCs live and work together (a warren, a barracks) and shouldn't stampede at their own shadows. Off by default; other encounters are unchanged.

- **Quiet about unknowns.** An unidentified figure or noise is never shouted about. Only an identified intruder, a creature with `"uncanny": true` (undead, glowing, huge: really freaky), or a witness with `superstition ≥ 0.8` raises a warning.
- **Second-hand reports of unknowns are discounted** (significance 1) unless the listener is superstitious.
- **`disposition.superstition` (0-1, default 0).** Vague sightings, and reports of them, scare the superstitious more (≥0.5: full significance and extra alarm). They also won't investigate an omen: they back away to their post and watch it. Ordinary comrades and plain, identified trouble don't trigger any of this.
