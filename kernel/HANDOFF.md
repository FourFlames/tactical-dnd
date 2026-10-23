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
- **Saves:** each room saves to `kernel/saves/<room>/` (git-ignored; `KERNEL_SAVES` overrides) and the
  server reopens it on start; delete the folder to start a room fresh (`kernel/DM.md`, "Saving").
  Server files: `main.rs` (handlers; one task per room), `store.rs` (the save), `inbox.rs`, `journal.rs`.
- **Check:** `cargo test --workspace` (37 tests) and `cargo clippy --workspace --all-targets` (clean),
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
   handler to `journal.log` + `journal.jsonl` (now in the room's save folder, git-ignored); `--re` on
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
Follow-ups: `a4` agent-call lines when agents arrive; "answered without a step" can't yet
tell whether the kernel already knew the answer (needs `knows`, step 4).

### Short-term plan: two playtest packages (agreed 2026-10-23)

The playable slice (P1–P6 in the design doc's build order) is cut into cards that reach a playtest fast.
What each ports from the Node engine, with file:line pointers: `docs/kernel-port-inventory.md`. Space
follows "Space and places" in the design doc; the server follows "The server".

**Package A: talk, explore and the timeline.** Playtest: the Crossroads Shrine with no combat: walk,
question Brother Osric about his book, then retcon something and watch the table see it. Tests the DM
loop, the journal and `dm review`, and timeline surgery in front of players.

- **A1. Rooms survive a restart (done)** (server; runs alone, it reshapes `server/main.rs`). Each room becomes
  its own task that handlers send requests to, replacing the one lock over all rooms. A room saves to
  `kernel/saves/<room>/`: step inputs on every branch with the branch heads (`steps.jsonl`), the inbox,
  and the journal (which moves in, so a restart continues the session instead of starting `-2`). On
  start the server reopens and replays. Done: a test that a replayed room equals the original; live,
  a restarted server shows the same map, messages and journal, with the `open` line marked as a resume.
  *How it saves:* every request runs as a job on the room's task (`RoomHandle::call`); after each job
  `Store::sync` appends new steps (all branches, serde JSON, the opening step carrying the room def and
  codex) to `steps.jsonl`, rewrites `branches.json` and `inbox.json` when they changed; the journal's
  own files live in the same folder and are read back on start (`open … resume=true`). Loading goes
  through `Timeline::restore` (keyframes are recomputed, not saved). Deferred: a torn last line in
  `steps.jsonl` after a hard kill is an error (the room is skipped, not overwritten); no save
  versioning; disk writes run on the room task (fine at this size); a leftover `kernel/sessions/` from
  earlier runs is no longer used and can be deleted.
- **A2. A first place layer** (core + room file). Places with a name, a parent and rectangles; "which
  place is this square in" (the most specific); places in the bundle ("Rook, in the nave, 10 ft from
  the altar"), `dm look` and journal lines; `move rook to altar` and `move rook to osric` in scripts.
  Everyone uses the DM's place names for now. Core first; the server wiring follows A1.
  **Core done:** `core/src/place.rs` (`Places::at`, `ancestors`, `within`, `position_text`),
  `RoomDef.places`, `Command::MoveToward` (resolved to a plain `Move`, so history never sees it), and
  the crossroads tree (shrine › nave › altar, east room, lower hall › ford). **Still to do:** call
  `places.position_text(pos)` from the wake bundle, `dm look` and journal step lines; teach the page
  and the DM tool schema the `move_toward` command. Known limit: "10 ft from" ignores walls.
- **A3. Narration** (core + page). A `say` command and event (all, or a whisper to one seat), in
  history like any step; `dm say`; a chronicle panel on the page in each seat's words.
- **A4. `dm see <seat> [at]`** (CLI + a read-only endpoint): the room, a square or a creature as that
  seat perceives it, flagging where it differs from the truth.
- **A5. Surgery reaches the table** (server + page): a seat that saw something a commit changed gets a
  notice in the chronicle before its page reloads.

Order: A1 (with A2's core part alongside in its own worktree) → A2 wiring ∥ A4 → A3 → A5 → playtest A.

**Package B: three goblins at the ford.** Rook and Wren against three goblins across the shallows, the
DM running the goblins by hand. Tests turn feel and the pace of the combat loop.

- **B1. Stat blocks, dice, checks:** AC, abilities, saves, skills, attacks, resources (the old engine's
  shape, so legacy encounters and builder output import); every roll an event with its dice, seeded
  per step; `check`, `save`, `ruling` with stakes set before the roll.
- **B2. Turns:** initiative, order, round, the turn tracker (move, action, bonus, reaction), Dash,
  Disengage, Dodge, End turn (seats their own, the DM anyone's), end combat; conditions as data
  (prone and unconscious first) with durations.
- **B3. Attacks and damage:** attack planning (reach, range, advantage folding; a clear-line stub until
  Space v1), crits, damage types, resistance, temp HP, healing, 0 HP and death saves for player
  characters (a mark, not a side).
- **B4. Opportunity attacks and offers:** provokes along the path; an offer to the reactor's controller
  (`dm oa` for monsters, a dialog for players); offers also carry DM terms with a skill and DC.
- **B5. The table UI:** turn bar with pips and Dash/Disengage/Dodge/Attack/End turn, initiative strip,
  offers dialog, dice toast (can start against a written view contract while B2–B4 land).
- **B6. The ford room:** goblin stat blocks and the shallows map.

B1–B4 share core files and go in order; B5 runs alongside. Then playtest B. Later packages, in order:
stealth and disguise on marks (with perception step 3), height and vantage (with Space v1), and a
remote seat over Tailscale whenever a friend can join.

**How cards are run:** one Sonnet per card with a brief naming the files it owns, what done looks like,
the tests and live check, and the git guardrails (no stash, checkout, reset or clean). Each card updates
this handoff and deletes the legacy code it replaced. The lead session reviews each diff before the
next card starts.

**Keep in mind while building and playtesting** (from "The server"):
- The DM role must stay harness-agnostic: one tool contract, served over HTTP, the `dm` command line and
  (later) MCP. Rely only on what nearly every agentic harness can do: tool/shell calls, files, HTTP,
  and self-contained prompts to a fresh context (subagents). Anything else is an optional speed-up
  with a plain fallback.
- Watch for: the DM misreading what a player means; how easily the DM can see the world as a player
  does (`dm see`); how manageable the state → view mapping is, including pending optimistic state.

### Then, from the build order

- Step 3: passive readings become traces during replay, stamped with game time; individuals bind marks.
- Then 4 (umwelt rendering, `knows`/`why`), 5 (memory decay, recall, recognition), 6 (agent replies with
  gist/actions/flag and stale detection), 7 (speech and pointing as marks), 8 (sidebar).
- DM-layer follow-ups: quiet/loud messages, a `needs_dm` queue beyond messages, deferred properties.
