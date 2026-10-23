# Tactical D&D: the Rust kernel

This branch replaces the Node engine with a Rust kernel. Most sessions here are building it; some run a
room as its DM.

## Start here

- **Building:** read `kernel/HANDOFF.md` first (what's built, how the user works, the next card), then
  the relevant parts of `docs/kernel-perception.md` (the agreed design; its **Build order** is the
  roadmap). `docs/kernel-port-inventory.md` lists what to port from the old engine, with file:line
  pointers, and the decisions behind the first playable slice.
- **Running a room as the DM:** `kernel/DM.md`.

## Layout

- `kernel/`: the Rust workspace. `crates/core` (pure rules, no I/O), `crates/server` (HTTP, SSE, inbox,
  journal), `crates/dm` (the `dm` CLI), `codex/` and `rooms/` (data), `web/` (the battlemap page),
  `sessions/` (journals, git-ignored).
- `legacy/`: the retired Node engine and viewer, kept as the reference while porting (its tests are the
  oracle for pathing, line of sight and cover). **Each kernel card deletes the legacy code it replaced.**
  The last commit before the move is tagged `node-engine-final`. Its own instructions: `legacy/CLAUDE.md`.
- `docs/`: kernel design and research; `docs/legacy/` holds the Node-era design docs.

## Rules

- Check with `cargo test --workspace` and `cargo clippy --workspace --all-targets`, from `kernel/`.
  On Windows, stop a running `kernel-server` before rebuilding it.
- Verify in the browser (the `kernel` entry in `.claude/launch.json`, port 5180) and report numbers.
- Commit only when the user asks.
- Never run legacy commands against the main checkout's `state.json`: a saved game may be in progress
  there. In this worktree, `legacy/` writes its state inside `legacy/`.
- Don't run `legacy/test-minds.js` unasked: it spends OpenRouter credit.
