# Kernel handoff

Read this first. Then `docs/kernel-perception.md` (the design: perception, identity, memory, timeline, DM
tools; its **Build order** is the roadmap) and, for the wider priorities, `docs/rust-kernel-api.md`.
`kernel/DM.md` is how a DM drives a room.

## Where things are

- **Branch:** `rust-kernel` (worktree `.claude/worktrees/rust-kernel`), on top of `154c6f2` from
  `codex/worldspace-orbs` (tagged `node-engine-final`), pushed to `origin/rust-kernel`.
- **The old engine** lives in `legacy/` on this branch (run it from that folder; `legacy/CLAUDE.md`). Each
  card deletes the legacy code it replaced. The main checkout still runs live Node games: never run legacy
  commands against its `state.json`.
- **Run:** `cargo run --manifest-path kernel/Cargo.toml -p kernel-server` (port 5180; `kernel` entry in
  `.claude/launch.json`). Battlemap at `http://localhost:5180/?as=dm`, or `?as=alice` / `?as=sam`.
  DM tool: `cargo build --manifest-path kernel/Cargo.toml -p kernel-dm`, then `kernel/target/debug/dm`.
- **Check:** `cargo test --workspace` (34 tests) and `cargo clippy --workspace --all-targets` (clean),
  from `kernel/`. On Windows the server exe is locked while the preview runs; stop it before rebuilding
  the server. A session whose browser pane reads the main checkout's `.claude/launch.json` won't find the
  `kernel` entry (it's only in this worktree): run the same `cargo run` in the background and open the
  pane at `http://localhost:5180/?as=alice`.

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
6. `1b1afb3` Card A, the session journal: `crates/server/src/journal.rs`, written from every server
   handler to `kernel/sessions/<room>-<date>[-n]/journal.log` + `journal.jsonl` (git-ignored); `--re` on
   `dm act` and surgery; `dm log`, `dm wish`, `dm review`; `script::write` turns commands back into
   script text; surgery takes `script` (parsed by the server, so its parse errors are journaled).

Crates: `kernel/crates/core` (pure rules, no I/O), `kernel/crates/server` (HTTP + SSE + inbox),
`kernel/crates/dm` (CLI). Data: `kernel/codex/*.json`, `kernel/rooms/*.json`. Page: `kernel/web/index.html`.

## How the user works

- Design is talked through first, then built; record agreed design in `docs/kernel-perception.md`.
- Commit only when asked ("Commit the working tree changes with a sensible message"); end commit
  messages with the Co-Authored-By line from the session's attribution reminder.
- No backwards compatibility with the Node engine or old saves is needed.
- Verify in the browser (preview tools) and report numbers; keep latency visible.

## Next cards

### Card A: the session journal (done)

See "The session journal" in `docs/kernel-perception.md` and `kernel/DM.md`. Example from a live run:
```
00:25:42.286 m1   sent      alice   "I head for the doorway in the south wall."
00:25:42.543 w1   wake      dm      m1 batch=1 waited=257ms idle=10.1s
00:25:50.267 #2   step      dm      "Rook steps into the south doorway" — Rook moves 10 ft to (4, 6) cmd="move rook 4,6" game=R1 re=m1? took=0.21ms
00:25:52.369 m1   reply     dm      "You stand in the doorway; …" after=10.1s
00:23:51.490 ?    parse     dm      act "walk rook to priest": unknown command "walk" re=m1
```
Follow-ups: `a4` agent-call lines when agents arrive; one session across restarts once rooms are saved
(today each start opens a new `-n` directory so refs stay unique); "answered without a step" can't yet
tell whether the kernel already knew the answer (needs `knows`, step 4).

### Next: the playable slice (agreed 2026-10-23)

Before perception step 3, so there's a game to test it in. Cards P1–P6 in the build order of
`docs/kernel-perception.md`; what each ports from the Node engine, with file:line pointers, is in
`docs/kernel-port-inventory.md`. Space follows "Space and places" in the design doc: frames joined by
portals behind a narrow `Space` interface (first implementation: one static frame), plus a place
layer (tree, memberships, links, optional extents) from P2 on. Start with P1 (save rooms to disk).

### Then, from the build order

- Save the timeline and inbox to disk (rooms survive a restart).
- Step 3: passive readings become traces during replay, stamped with game time; individuals bind marks.
- Then 4 (umwelt rendering, `knows`/`why`), 5 (memory decay, recall, recognition), 6 (agent replies with
  gist/actions/flag and stale detection), 7 (speech and pointing as marks), 8 (sidebar).
- DM-layer follow-ups: quiet/loud messages, a `needs_dm` queue beyond messages, deferred properties.
