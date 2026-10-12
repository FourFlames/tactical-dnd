# Card 6: event stream + playback (spec)

Why: the player view gets only the last 80 public log entries, and `logArrival` (viewer.html) and map3d's `playMoves` find new ones by matching JSON snapshots. Once the window slides, nothing matches, and dice/hit fx, the ticker and 3D glides go quiet. Rewording hidden turns in `publicLog` breaks the match too. The fix is a sequence number on every entry, and one ordered playback queue in the viewer.

Two halves, done in order: **6a** (server) then **6b** (viewer). Each fits one session.

## Design calls (decided; don't relitigate)

- **`n` is the entry's line number in `log.jsonl` (1-based), assigned in `readLog`, not stamped by `appendLog`.** The log is append-only, and `load` is the only thing that resets it (it unlinks the file). A line number can't race when the engine and the server append at the same moment, and logs written before this change get numbers for free. Don't write `n` into the file.
- **Game id:** `load` sets `enc.game` (e.g. `Date.now().toString(36)`). `view()` returns `game: s.game || null`. The viewer resets when `game` changes, and also when the highest `n` it sees is lower than what it already played. That second check covers states saved before this change.
- **`publicLog` keeps `n`.** Every entry it emits, including reworded or merged turn lines, carries the `n` of the source entry it came from (for a merge, the last one). Skipped secrets leave gaps, and that's fine: the viewer uses `n > played`, never `n === played + 1`.
- **Older log:** `GET /api/log?before=<n>&view=dm|player[&limit=80]` returns `{ game, log }`: up to `limit` entries with `n < before`, filtered exactly like the window (secrets out for players, hidden turns reworded). The DM view stays local-only, the same check as `/api/state`.
- **One playback queue in the viewer** drives everything that animates, in log order, in 2D and 3D: the move glide (3D) or hop (2D), the move trail, dice and hit fx, and the ticker. The goblin arrives, then its d20 lands, then the ticker line shows.
- **Held positions.** While a creature has a queued move that hasn't played yet, it's drawn at that move's start square, not at its polled position. The viewer keeps `heldAt = { id: cell }` and builds the display copy of the state with those positions before it calls `render`/`map3d.update`. When the move plays, the hold moves to the next queued move's start, or is released.
- **The sidebar log shows an entry once it has played**, or once catch-up or Skip has passed it. A die must not land after its result is already printed in the log.
- **Catch-up:** play only the current turn. It kicks in (a) on the first refresh after the tab comes back from hidden (`visibilitychange`) or the event source reconnects, (b) when the backlog would take more than ~8 s at the current speed, and (c) on the first load (nothing replays at all). Catch-up drops every queued entry before the last `turn` entry in the queue: dropped entries go straight into the log, and their holds are released. While the tab is hidden, the queue doesn't play.
- **Skip to now** finishes the current item at once, empties the queue, releases all holds and snaps 3D tokens. It sits beside an **animation speed** control (½×, 1×, 2×, 4×; localStorage `animSpeed`, default 1×). Every duration reads one `speed()`: fx sleeps, the die spin, shot flight, the 3D glide rate, trail fade and ticker dwell. Don't scatter `/ speed` around: build the timing on one helper, e.g. `ms(600)`.
- **Hidden creatures:** a move entry whose creature isn't in the client's `state.creatures` (or is `hidden`) plays as no animation, just a log line.
- **Scrolling the sidebar log to the top** fetches `/api/log?before=<lowest n shown>` and prepends the result (keep the scroll position). Stop once a fetch returns nothing. Discard the result if `game` changed.

## 6a — server (lib/core.js, engine.js, server.js, test.js)

1. `readLog(n)` assigns `n` from the line index across the whole file, then slices.
2. `load` sets `enc.game`. `view()` returns `game`.
3. `publicLog` keeps `n` on everything it emits.
4. Factor the "log as this viewer may read it" logic in `view()` into one helper, so `/api/log` and `view()` share it. Add `/api/log`.
5. Tests in `test.js`: append past 80 entries and check that the player window's `n`s are increasing and end at the last line; equal timestamps don't matter (several entries in one ms keep distinct `n`s); `load` gives a new `game` and `n` restarts at 1; a reworded hidden turn keeps its source `n`; `before=` returns older entries, filtered (no secrets), and nothing once it passes `n` 1.

## 6b — viewer (viewer.html, viewer/map3d.js)

1. Delete `logArrival`, `tickerTracker`, `fxTracker` and map3d's `playMoves`/`previousLog`/log diffing. Keep map3d's glide mechanics (`userData.path`, the trail), but drive them from outside. Expose `map3d.glide(id, cells) → Promise` (it resolves when the token arrives, or at once if there's no token), `map3d.snap()` (finish all glides now), and `map3d.setSpeed(k)`.
2. One `playback` module in viewer.html: `played` (`{ game, n }`), `queue`, `heldAt`, `shownN` (the log renders entries with `n <= shownN`, plus everything when nothing is queued), `speed`. On each refresh: reset if needed, push the fresh entries (`n > played.n`), apply the catch-up rule, and kick the runner if it's idle. The runner plays one entry at a time: for a move, a 3D glide or a 2D hop plus the trail; for an entry with roll data, the existing `playFx`; then the ticker line; then `shownN = e.n`, and the log redraws.
3. 2D: draw a token at `heldAt` while held. When its move plays, draw the trail (`drawTrail`) and put it at the destination. A tween is nice but optional.
4. Speed control and Skip to now: a small segmented control plus a button near the ticker or the dice tray. Skip shows only while something is queued.
5. Older log on scroll-to-top (above).
6. Check in the sandbox (`preview_start viewer-sandbox`, `node tools/sandbox.js load tollhouse`, or `rope-bridge` for a quick fight). Run a monster turn as a burst (`move`, `attack`, `next` back to back) and watch the order in 2D and `?3d`. Then 85+ entries, to see that fx still fire after the window slides; a background-tab catch-up; Skip; 4×; a `load` mid-playback. Take screenshots.

## Pitfalls

- `render()` runs on every refresh. Don't let it redraw the log from `state.log` unfiltered, or a result shows before its die lands.
- map3d currently lerps a token toward its polled position. A held token must not lerp to the destination while it waits, so the held display copy must reach map3d too.
- `queueFx` and `drawActionStatus` both run from `refresh()` today. Fold them into the single runner; don't leave two consumers of the log.
- The `dmResolving` strip isn't log-driven. Leave it as it is.
