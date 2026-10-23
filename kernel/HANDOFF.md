# Kernel handoff

Read this first. Then `docs/kernel-perception.md` (the design: perception, identity, memory, timeline, DM
tools; its **Build order** is the roadmap) and, for the wider priorities, `docs/rust-kernel-api.md`.
`kernel/DM.md` is how a DM drives a room.

## Where things are

- **Branch:** `rust-kernel` (worktree `.claude/worktrees/rust-kernel`), on top of `154c6f2` from
  `codex/worldspace-orbs`. Nothing pushed. The Node engine in the repo root is untouched and still runs
  live games; never run its commands against the root `state.json`.
- **Run:** `cargo run --manifest-path kernel/Cargo.toml -p kernel-server` (port 5180; `kernel` entry in
  `.claude/launch.json`). Battlemap at `http://localhost:5180/?as=dm`, or `?as=alice` / `?as=sam`.
  DM tool: `cargo build --manifest-path kernel/Cargo.toml -p kernel-dm`, then `kernel/target/debug/dm`.
- **Check:** `cargo test --workspace` (28 tests) and `cargo clippy --workspace --all-targets` (clean),
  from `kernel/`. On Windows the server exe is locked while the preview runs; stop it before rebuilding
  the server.

## What's built (commits on the branch, oldest first)

1. `ca1d577` Event-sourced room, axum server, SVG battlemap, click-to-move with dry-run route previews.
2. `e6338e7` Opaque `EntityId`s that never leave the kernel; per-observer names (`Handle`s); commands
   resolved from the sender's names; structured `Rejection`s explained per observer.
3. `090c126` Codex of identities and mark kinds with reading trees (attention, gates, ladders, passive
   −5 without proficiency); stance from dispositions replaces sides; blocking by the occupant's stance.
4. `4bc3c1e` Timeline: steps (input + outcome), dice tied to steps, game clock, surgery drafts with
   summary-first previews, commit/discard/rewind, keyframes, drop-and-flag.
5. `6899728` DM tools: short command language (`script.rs`), inbox with instant acks and batched wakes
   (`dm wait`), context bundle, hop timings (`dm stats`), the `dm` CLI, the page's "Tell the DM" box.

Crates: `kernel/crates/core` (pure rules, no I/O), `kernel/crates/server` (HTTP + SSE + inbox),
`kernel/crates/dm` (CLI). Data: `kernel/codex/*.json`, `kernel/rooms/*.json`. Page: `kernel/web/index.html`.

## How the user works

- Design is talked through first, then built; record agreed design in `docs/kernel-perception.md`.
- Commit only when asked ("Commit the working tree changes with a sensible message"); end commit
  messages with the Co-Authored-By line from the session's attribution reminder.
- No backwards compatibility with the Node engine or old saves is needed.
- Verify in the browser (preview tools) and report numbers; keep latency visible.

## Next cards

### Card A: the session journal (agreed, not started)

An append-only operations log, separate from the timeline (surgery never rewrites it).

- `kernel/sessions/<room>-<date>/journal.log`: one line per event, always
  `<time> <ref> <verb> <actor> <payload> [key=value …]`, refs prefixed so one grep finds an item's whole
  story: `m3` messages, `#12` steps, `draft-15` branches, `w7` wakes (later `a4` agent calls). Plus a
  `journal.jsonl` twin for structured queries.
- Log: messages (sent, reply, done), wakes (batch ids, wait time), steps (gist, line, took), refusals,
  parse errors, surgery previews/commits/discards, rewinds.
- `dm act … --re 3` and replies tag what they resolve (`re=m3`); untagged ones are guessed by timing and
  marked as guesses.
- `dm log [--re m3] [--kind …] [--who …] [--since …]`; `dm wish "…"` for tools the DM wanted.
- `dm review`: the post-mortem report: messages that could have skipped the DM (resolved only by moving
  the sender's own creature, or answered with facts the kernel already had), rulings, slowest waits,
  wishes, parse errors (missing commands), refusals, fiat used.

Example lines:
```
10:02:11.402 m3  sent      alice   "I walk over and ask the priest what that book is." at=priest→osric
10:02:11.655 w7  wake      dm      m3 batch=1 waited=253ms
10:02:20.118 #4  step      dm      "Rook walks over to Brother Osric" — Rook moves 20 ft to (4, 4) re=m3 took=0.3ms
10:04:02.511 ?   parse     dm      act "shove grub east": unknown command "shove"
```

### Then, from the build order

- Save the timeline and inbox to disk (rooms survive a restart).
- Step 3: passive readings become traces during replay, stamped with game time; individuals bind marks.
- Then 4 (umwelt rendering, `knows`/`why`), 5 (memory decay, recall, recognition), 6 (agent replies with
  gist/actions/flag and stale detection), 7 (speech and pointing as marks), 8 (sidebar).
- DM-layer follow-ups: quiet/loud messages, a `needs_dm` queue beyond messages, deferred properties.
