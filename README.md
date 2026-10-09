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

The viewer has a **Player** view (fog of war, hidden enemies stay hidden, enemy HP shown only as healthy/bloodied) and a **DM** view at `/?dm` (everything, including secret notes).

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

Creatures need `name`, `side` (party/enemy/neutral), `controller` (player/llm/dm), `pos`, `hp`, `ac`, `speed`, `stats`, and `attacks`. Optional: `skills`, `saves`, `resist`/`immune`/`vulnerable`, `hidden`, `notes`, `persona` (for LLM party members).

## Developing in a cloud session

Building the engine and viewer works well in a Claude Code cloud session pointed at this repo. Play locally, though, so the viewer can watch `state.json` on your machine.
