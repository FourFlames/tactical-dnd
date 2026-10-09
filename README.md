# Tactical D&D

Tactical D&D 5e combat with Claude Code as the Dungeon Master, a small deterministic rules engine underneath it, and a live battlemap in your browser.

You type what your character does. The DM turns it into engine commands, the engine validates and rolls, and the map redraws itself. Creative actions ("I kick the brazier into the oil") become **rulings**: the DM sets the DC and stakes up front, the dice decide, and the engine applies the outcome.

## Run it

You need Node 18+ and Claude Code, logged in with your Claude subscription. (If `ANTHROPIC_API_KEY` is set in your shell, Claude Code bills the API instead, so unset it.)

```bash
# terminal 1: the battlemap
node server.js            # open http://localhost:5173

# terminal 2: the DM
claude                    # or: claude --model haiku  (faster, cheaper turns)
```

Then tell the DM something like: *"Load rope-bridge and let's play. I'm Rook."*

The viewer has a **Player** view (fog of war, hidden enemies stay hidden, enemy HP shown only as healthy/bloodied) and a **DM** view at `/?dm` (everything, including secret notes). Both come in **2D** and **3D** (`/?3d`, or the toggle in the top bar). The 3D map shows floor heights, props and walls with procedurally generated textures: drag to orbit, right-drag to pan, scroll to zoom, and **Low walls** cuts walls down so you can see into rooms. It loads three.js from a CDN, so it needs an internet connection; the 2D map doesn't.

## Playing with friends

Tell the DM who's joining and which character they play ("Sam is joining as Wren"). The DM runs `node engine.js seat sam wren`, which prints a personal link like `http://10.0.0.5:5173/?seat=...`. Your friend opens it, watches the map live, and types actions into the **Your move** box on their turn. The DM picks those up and resolves them through the engine.

- **Same Wi-Fi:** the printed LAN link works as is.
- **Over the internet:** both of you install [Tailscale](https://tailscale.com), then `seat sam wren --host http://<your-tailscale-ip>:5173`. Avoid exposing the port to the open internet.
- The link is the player's key, so share it privately. `unseat sam` revokes it.
- The DM view (`/?dm`) only works from the machine running the server.

## How it fits together

```
you ──► Claude Code (DM, reads CLAUDE.md)
           │  node engine.js move / attack / ruling / ...
           ▼
        engine.js ──► state.json + log.jsonl ──► server.js ──► viewer.html (live)
           ▲
        ext/*.js   approved library commands, loaded automatically
```

| File | What it is |
|---|---|
| `CLAUDE.md` | The DM's instructions: turn loop, rulings, escalation, the library workflow |
| `engine.js` | The rules engine CLI. `node engine.js help` lists commands |
| `lib/core.js` | Grid math, pathing, line of sight, cover, dice, player/DM views |
| `server.js`, `viewer.html` | Local viewer, no dependencies |
| `viewer/map3d.js`, `viewer/textures.js` | The 3D map (three.js) and its procedural textures |
| `encounters/` | Encounter files: map rows, terrain legend with tags, creatures |
| `ext/` | Library commands (`shove.js` is the example and template) |
| `pending/` | Proposed library commands awaiting JD's stamp and your approval |
| `.claude/agents/pc.md` | Plays LLM party members (Haiku). Declares actions; the DM executes |
| `.claude/agents/jd.md` | J. D., Rules Lawyer (Opus). Hard rulings and library reviews |
| `test.js` | Engine smoke tests: `node test.js` |

## Making encounters

Copy `encounters/rope-bridge.json`. Maps are rows of characters; the `legend` gives each character a name and **tags**. Tags drive both the rules and the DM's creativity:

- Engine rules: `wall` (blocks movement and sight), `impassable`, `opaque`, `difficult`, `water`, `cover-half`, `cover-3q`, `burning`
- Hooks for rulings: `flammable`, `can-topple`, `climbable`, `slick`, `narrow`, `chasm`, `fire-source`... invent your own

Optional extras, all of which the 3D map draws (try `encounters/watchtower.json`):

- **Height.** A `heights` grid alongside `rows`: one string per row, each digit a 5-ft step (`2` = 10 ft up), `.` = use the legend. Or give a legend entry `elev` in feet. Water cells can set `depth` in feet.
- **Props.** A legend entry can say what it is with `object`: `{ "kind": "crate", "height": 4 }`. Kinds: `crate`, `barrel`, `rubble`, `pillar`, `brazier`, `tree` (anything else draws as a block). Climbable props are stood on (a creature in a crate square is 4 ft up); set `"stand": false` to override. Props can also be placed by cell with a top-level `objects` list: `{ "at": "C3", "kind": "barrel", "height": 4, "tags": ["flammable"] }`.
- **Walls along grid lines.** A `walls` list of vertex-to-vertex lines. Vertex `D3` is the top-left corner of square D3, so `"D2-D6"` runs down the left side of column D for four squares. Use an object for anything but a plain wall: `{ "id": "door1", "kind": "door", "from": "D8", "to": "E8" }`. Kinds: `wall` (blocks movement and sight), `door` (blocks until opened with `node engine.js door door1 open`), `window` (blocks movement, half cover), `low` (half cover, costs 5 ft extra to cross). Add `"hidden": true` for a secret door that only the DM view shows until it's opened.

Height is part of the rules (2024 PHB, with a couple of house extensions):

- **Distance** counts height as a third axis, the same way diagonals count: a goblin on a 10-ft ledge next to you is 10 ft away, out of a 5-ft reach.
- **Climbing** a ledge of 5 ft or more costs each foot climbed twice, up or down. Stairs (tag `stairs`) are ordinary walking, creatures with a climb speed (`"movement": "climb"`) pay normal cost, and `unclimbable` squares can't be scaled. `move --fast-climb` climbs at full speed instead, with an Athletics check against the ledge's climb DC (legend `climbDC`, else the encounter's `climbDC`, else 12); failing means falling.
- **Jumping**: `move --jump` lets the path long-jump in a straight line over difficult terrain, chasms and low walls. The jump can be up to your Strength score in feet with 10 ft of run-up in the same move (or `--running`), half that standing. Each obstacle has a height in feet: a prop's `height`, or the legend's `obstacle` (default 0, so ice or a stream only tests distance). Anything up to your high jump (3 + Str mod, half standing) is cleared freely; taller needs Athletics, DC 5 + 3 per foot of excess, and failing trips you into it, prone.
- **Jumping up a ledge** (also `--jump`): one within your high jump you land on. A taller one you can grab for free if it's within your high jump plus your reach (1.5 x your height: about 9 ft for Medium, 5 ft for Small; creatures can set `size` or `height`), then haul up as 5 ft of climbing. Add `--fast-climb` to haul up quickly with an Athletics check against the climb DC (failing falls from the lip), or use `--vault` to land on top in one bound: DC 5 + 3 per foot the ledge is taller than your high jump, and failing drops you back down, prone.
- **Falling**: `fall <id> [cell] [--feet N]` deals 1d6 per 10 ft (max 20d6) and leaves the creature prone. Water halves it, and an Athletics/Acrobatics check (DC 10 + 1 per 10 ft) cuts it to a quarter. Shoving someone off a ledge makes them fall.
- **Sight and cover** are traced in 3D from eye height (5 ft) to the target's head and middle, from the best point of the viewer's square. Raised ground blocks sight, cover only counts if it rises above the line where it's crossed (props by their `height`, low walls 3 ft), and a target showing only its head over something solid has three-quarters cover. High ground gives no attack bonus, just better angles.

Creatures need `name`, `side` (party/enemy/neutral), `controller` (player/llm/dm), `pos`, `hp`, `ac`, `speed`, `stats`, and `attacks`. Optional: `skills`, `saves`, `resist`/`immune`/`vulnerable`, `hidden`, `notes`, `persona` (for LLM party members).

## Developing in a cloud session

Building the engine and viewer works well in a Claude Code cloud session pointed at this repo. Play locally, though, so the viewer can watch `state.json` on your machine.
