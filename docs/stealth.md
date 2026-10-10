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

Model routing is by `tier`: `minion` → haiku, `elite` → sonnet, `commander` → opus. Override per NPC with `model`, per encounter in `mindConfig.models`, or for the whole table in `minds.config.json` at the project root. For a Claude model, call the `npc` agent with that model. It can run exactly one command, `node engine.js mind <id> brief` (a hook blocks anything else), so it can't read the state, the map or the DM's notes.

**OpenRouter models think on their own.** A model id with a slash (`deepseek/deepseek-v4.1-flash`, the table default for minions) is called by the engine itself (`lib/think.js`), with the key from `OPENROUTER_API_KEY`. Before a `tick`, and before `mind <id> act`, every such mind with news thinks in parallel from the same moment; its answer goes through the same `decide`, and an answer with nothing usable gets one retry with the reasons. No key, a timeout or a bad answer: that NPC acts on the fallback. `think [<id>...]` asks on demand (`--all`: everyone on OpenRouter). `minds` shows calls, tokens, cost and latency per model. Skip it for one command with `--no-think`.

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

- Batching several minions into one model call, latency budgets, and token accounting for Claude-tier minds (OpenRouter minds are counted).
- Seeded dice and full deterministic replay. Decisions are recorded in traces and the log, but the engine's dice use `Math.random`.
- Model-assisted memory consolidation. Old observations roll into a memory list deterministically, keeping their ids.
- A cognition overlay in the viewer. The inspector is `mind <id>` in the terminal: each track next to the truth.
- Rich sound propagation (around corners, along corridors). It's a straight line with wall penalties, so winding cracks muffle far more than they should.
- Languages: everyone in earshot understands everyone.

## Places: how NPCs talk about the map

An encounter can name its places: `"places": [{"name": "the cookfire", "at": "J14"}, {"name": "the warren", "area": "F11:U19"}]` (`at` is a landmark, one square or a small range; `area` is a region). Then:

- **Speech never carries squares.** Whatever an NPC says is rewritten before anyone hears it: "Intruder at K29!" is heard as "Intruder at the west gap!" A square is named by a landmark within 5 ft, else the smallest area it's in, else a landmark within 10 ft, else "west of the cookfire" (30 ft), else "over there". The structured `about.at` still carries the exact square between NPCs, like pointing.
- **Briefs name places next to squares** ("L18 (the crack mouth)"), list the places, and show only the map within 7 squares; where a lost track could have got to is given as place names.
- **Decisions may use a place name for a square** ("to": "the boss's corner").

Encounters without `places` keep their squares everywhere.

## Hearing words, knowing voices

Sound uses the same rule as before (straight-line distance plus muffling against loudness), but how close a sound is to the edge of earshot now matters:

| Share of earshot used | Words | Voice |
|---|---|---|
| up to 60% | every word | a comrade's voice is known |
| 60-80% | some words lost (“Check … by the path.”) | still known (a familiar voice carries through a wall) |
| 80-95% | some words lost | only "a voice that might be Bram's", unless they name themselves ("Grub here!") |
| 95-100% | none: "shouting, too far off to make out" | "a distant voice" |

The party's chronicle gets the same: garbled or distant when nobody in the party heard it clearly. Seeing the speaker settles who it is.

**Impersonation.** `speak <id> "<words>" --as <npc> --deception <total>` lets a character pretend to be an NPC. Anyone who hears the voice well enough to know it compares their passive Perception with the Deception total; the rest are fooled, and a fooled goblin takes the words (and orders, and standing orders) as that NPC's. `speak` without `--as` is how party members talk to NPC minds at all.

## Recognising comrades in the dark

Sight still gives clarity (identified ≥ .65 for strangers, ≥ .45 for comrades). Below that, a figure **your own size** (`size` on creatures; goblins, halflings and children are `small`) is "built like one of yours": noted, not news, not a target for the default plans. A halfling in the gloom gets that benefit of the doubt too. A figure that speaks in a comrade's voice becomes that comrade, as far as the listener can tell, until a clearer look says otherwise. Briefs tell models to challenge an unclear figure before attacking it, unless their orders say otherwise.

## Physical evidence

`evidence <id|cell> "<what anyone looking closely would find>"` puts clues in the world: wounds on a body, tracks in the dust, a dropped knife. A body seen from afar is only "lies still… can't tell if asleep, hurt or dead" (curious, not combat); within 10 ft it's "is dead", with its evidence. Clues on squares are found by searching within 10 ft. (`describe` is different: it records what the *party* knows.)

## Stories going around

Heard news is kept as **claims**, matched by content-word overlap (no model). The same story again adds a source, not an observation, and doesn't trigger thinking; one that brings new detail is news. A retelling ("Grub says…") is a relay; a different witness is independent confirmation. Gullible listeners (low vigilance, or superstitious) count relays as confirmation too, so rumours inflate in some heads and not others. When a story first has two supporters, the listener gets "Now N goblins are telling the same story". Speakers won't repeat something they said in the last three rounds. A report about a place (or a body) is pinned there as a fixed site, not tracked as something that walks.

## Standing orders

Task orders say "go there and do this". **Standing orders** are rules that hold until lifted: `hold-fire`, `engage` (attack intruders on sight, and figures not built like your own), `raise-alarm` (shout about anything suspicious, even in a calm lair), `pairs` (nobody goes off alone), `hold-post`, or `custom` (words only). Officers give them in `standing` (`to`, `kind`, `text`, `rounds`, `lift`); an order shouted to everyone in `say`, a plan step, or `orders` with `"to": "all"` is classified by its words ("alone" → pairs, "hold your fire" → hold-fire…).

Each listener who takes the voice for a superior's gets the rule with an **adherence** (0.4 obedience + 0.35 the issuer's authority + 0.25 loyalty), shown in the brief as "inclined to keep it: strongly / fairly / barely". Models decide for themselves. The default plans keep a rule or not by adherence (fixed per NPC and rule): they won't attack under hold-fire unless attacked, won't investigate off-post, and call for company instead of going alone. Breaking a rule is never blocked, but whoever sees it and knows the rule notices ("Saw Gix go off alone toward the west rubble, against your order"), the issuer most of all.

## Forgiving decisions

Cheaper models slip in predictable ways, so `decide` fixes what has one obvious meaning and says so ("fixed: …"): a map mark ("1") for a track key, a place name for a square, an order filed under `say` (sent as an order if it's to subordinates, otherwise as a warning), a square nobody can stand on (moved to the nearest one within 10 ft), and evidence ids it never had (dropped, keeping the belief if any real evidence is left). Orders don't make tracks: an overheard order is just words, and an accepted order outranks chasing leads in the fallback. A new order from the same superior supersedes the old ones.

## Calm lairs and superstition

Set `"mindConfig": {"calm": true}` for an encounter where NPCs live and work together (a warren, a barracks) and shouldn't stampede at their own shadows. Off by default; other encounters are unchanged.

- **Quiet about unknowns.** An unidentified figure or noise is never shouted about. Only an identified intruder, a creature with `"uncanny": true` (undead, glowing, huge: really freaky), or a witness with `superstition ≥ 0.8` raises a warning.
- **Second-hand reports of unknowns are discounted** (significance 1) unless the listener is superstitious.
- **`disposition.superstition` (0-1, default 0).** Vague sightings, and reports of them, scare the superstitious more (≥0.5: full significance and extra alarm). They also won't investigate an omen: they back away to their post and watch it. Ordinary comrades and plain, identified trouble don't trigger any of this.
- **Comrades' words are news, not alarms.** Orders, questions and reports from a known comrade make a listener think but don't raise alarm. A warning alarms as far as it's believed (see Credibility, below), so one with nothing behind it is just talk (models mislabel questions as warnings).
- **Doors.** Watching a comrade open or shut a door is a fact ("Hennick opened the larder door"), not news. A door found changed with no threat in mind is noted quietly ("one of the others, most likely").
- **No fighting mood without a threat.** With nothing hostile or uncanny tracked (seen or reported), alarm can't rise past `curious`, and it cools twice as fast. A real intruder lifts the ceiling at once.

Everywhere: an order slipped into a plan step goes out as a real order to subordinates and as a report (word passed on) to equals or superiors. A party member gives a task order with `speak <id> "..." --kind order --to <ids>`.

## Credibility: how sure they sound, and how far they're believed

Reports, warnings and answers carry a **stated certainty** (`"certainty": "sure" | "fairly sure" | "unsure" | "guess"` or 0-1 in a `say`; `--certainty` on `speak`). The engine knows what the speaker's own evidence **warrants**: a creature in sight 0.95, a clear sighting a round or two old a little less, a glimpse or movement 0.4-0.6, a retelling only as much as they believed it, a comrade's body 0.95, nothing at all 0. Leave certainty out and they sound exactly as sure as their evidence.

- **Bluffing.** Stating more than the evidence warrants (by over 0.15) is a bluff: one Deception roll per utterance against each listener's passive Insight. Each point of excess sells 0.15 more of the false confidence, up to what was stated; a listener who beats it hears the speaker overselling ("...you doubt they really believe it" when there was nothing behind it). A minded NPC who bluffs is detected automatically. A player or other mindless speaker bluffs with `--bluff` (`--deception N`, or it's rolled).
- **Persuasion.** `"persuade": true` (`--persuasion [N]`) puts an honest speaker's weight behind their word: each point over a listener's passive Insight raises that listener's trust in them for this message.
- **Belief.** Credence = apparent certainty × (0.4 + 0.6 × trust in the speaker), × 0.8 if muffled; an unrecognised voice is trusted 0.3. Listeners read "They sounded certain / fairly sure / unsure", and reported tracks keep their credence (a retelling is only as good as it was believed).
- **Alarm.** A warning's alarm scales with credence: ≥ 0.55 is a full alarm (a certain warning from someone with no reason to doubt them puts a typical listener on alert or ready to fight at once), ≥ 0.3 a moderate one, below that little. A believed warning (≥ 0.5) lifts a calm lair's ceiling for five rounds, place or no place.
- **No trust meter.** Being caught overselling is written into what the listener heard (`caught` on the observation), and the claims system already tracks who said what and whether it was confirmed. What a mind makes of a comrade who cries wolf is left to its model, so reputations emerge rather than being counted.
