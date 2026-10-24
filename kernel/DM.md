# Running a kernel room as the DM

The kernel server (`cargo run --manifest-path kernel/Cargo.toml -p kernel-server`, port 5180) holds the
rooms. You act through `dm` (build once: `cargo build --manifest-path kernel/Cargo.toml -p kernel-dm`,
then `kernel/target/debug/dm`). Every answer is short text: one line per step, ids you can pass back.

## The loop

1. Keep `dm wait` running **in the background**. It returns the moment a player messages you, with every
   message that arrived in the same moment, already bundled with what you need: the speaker's sheet, what
   they pointed at (resolved, with distance), who's nearby and how they stand, and the last few steps.
   The players are told "The DM is reading…" when it returns.
2. Resolve each message, usually in one call: `dm act "…" --gist "…" --re <id>` for what happens, then
   `dm reply <id> "…" --done`. `--re` links the step to the message in the journal. A quick `dm reply <id> "Rolling for it…"` first is good when the
   resolution will take a while.
3. Re-arm `dm wait`.

Any command prints `📨 N new messages waiting` when players are waiting on you.

## Commands

```
dm look                                   place tree (keys), then everyone: square, place, HP, stance
dm act "move rook 4,5; wait 1 round" --gist "Rook advances"   one step; --dry previews it
dm history 20                             recent steps
dm reply 3 "It's locked." --done          answer message #3
dm insert 12 "place snikka 4,6" --gist "Snikka was guarding the door"   edit history:
dm remove 14 · dm edit 14 "move rook 2,1" · dm fiat 14                   each prints a preview
dm commit draft-15 · dm discard draft-15 · dm branches · dm rewind 9
dm stats                                  how long players waited at each hop
dm see sam [priest | 5,9]                 the room as sam perceives it, next to the truth
dm log [--re m3] [--kind step,reply] [--who alice] [--since 10:02|5m]   the session journal
dm wish "walk <who> to <someone>" --re 3  note a tool you wanted and didn't have
dm review                                 post-mortem: what skipped the DM, rulings, waits, wishes
```

Script: `move <who> <x>,<y>` · `move <who> to <place or who>` (`move rook to altar`, `go rook to osric`) · `place <who> <x>,<y>` · `wait <n> s|rounds|min|hours`, one per line or `;`.
Names are your handles (`dm look` lists them, and prints the place tree under its header, e.g.
`shrine › nave › altar · east-room · lower-hall › ford`: type those keys). Step lines and the wake
bundle say where things are (`Rook moves 15 ft to (4, 1), at the altar`; `in the nave, 10 ft from the altar`). Players' handles differ; the bundle translates.

## Saving

Rooms are saved to `kernel/saves/<room>/` after every request (override the folder with `KERNEL_SAVES`)
and reopened when the server starts: steps on every branch, branch heads, the inbox and the journal.
A restart picks up where it stopped: same map, messages and history, message ids and `w`/`#` refs
continue, and the journal gets a new `open` line ending `resume=true`. A saved room keeps its own copy of
the room definition and codex, so editing `kernel/rooms/<room>.json` changes nothing for it.
**To start a room fresh, stop the server and delete its folder** (`kernel/saves/<room>/`).

## Seeing what a player sees

`dm see <seat>` lists every creature that seat perceives, in its names, with what it reads from each,
how it stands toward it, and `≠ truth: …` where that differs from what you know (a real name, an
identity it hasn't read, a stance that would change). `dm see <seat> <their handle | x,y>` details one
creature or square: each reading it reaches, and under `does not reach:` the ones it doesn't, with
what blocks them (`needs a close look`, `knows elvish`, `arcana DC 12 vs passive 10`). Use it for
"why does Sam think…?" before you answer.

## Rules of thumb

- Always give a `--gist`: it's the step's line in history, and only you and its author see it.
- Tag what a step resolves with `--re`. Whenever you reach for a command that doesn't exist, or work
  around a missing tool, say so with `dm wish`: the review collects them.
- Edits to the past make a draft. Read the preview (summary first; ⚠ lines need a decision; "seen by"
  says which players to tell), then commit or discard. Nothing is lost: old mains stay as branches.
- Dropped steps (no longer legal after an edit) stay visible with the reason. `dm fiat <step>` keeps
  one anyway.
