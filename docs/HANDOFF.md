# Handoff

The baton for short sessions. **Read this file and nothing else up front.** Then read only what your card points to. Keep this file under ~80 lines: replace old content, don't append essays.

## Rules (every session)
- **A live game may be running** on port 5173 from `state.json` in the repo root. Never run engine commands there, and never edit `state.json` or `log.jsonl`.
- Test in the sandbox: `node tools/sandbox.js <engine command>` (data in `.sandbox/`), and the viewer via `preview_start viewer-sandbox` (port 5174). `node test.js` and `node test-minds.js` use a temp folder on their own.
- **3D in a cloud session:** the sandbox can't reach the CDN, so `?3d` says "couldn't load". Run `npm pack three@0.160.0` in a scratch folder and untar it. Then, in headless Playwright (Chromium at `/opt/pw-browsers/chromium`, launched with `--use-gl=swiftshader --enable-unsafe-swiftshader`), serve it in place of the CDN: `page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r) => r.fulfill({ path: '<scratch>/package/' + r.request().url().split('three@0.160.0/')[1], contentType: 'text/javascript' }))`. Join links keep extras: `/j/<code>?3d`. A double-click needs two `mouse.click`s under 400 ms apart (`locator.click` waits too long).
- The server reads `viewer.html` fresh on every page load, so work on the branch below and don't leave half-done viewer edits on `main`.
- Design references, read only if your card names them: [plan-playable.md](plan-playable.md) (the why), [wheel-lexicon.md](wheel-lexicon.md) (wheel slot intuitions; a scratchpad, the code wins).
- Match the surrounding code: no build step, no dependencies, plain JS, comments only where the why isn't obvious.

## When you finish a card
1. Tests pass, and the change is checked in the sandbox viewer (a screenshot for UI work).
2. Commit on the branch (one card, one commit or a few).
3. Edit this file: tick the card, update **State**, add one line to **Log** (newest first, keep 8).
4. Report back in 5 lines or fewer: what changed, what's left, any surprises.

## State
- Branch: `playable-1`. Pushed: hidden turns + initiative strip; minds talk menus; `TDND_DATA` sandbox.
- Card 1 merged into `playable-1` (`08db108`).
- Wheel mockups: `poc/wheel.html` (2D) and `poc/wheel3d.html` (3D; Wheel mode = pip wheel `poc/pip-wheel.js` around the body, Bar mode = action bar under the square), open with `preview_start poc` (port 5175). Feel signed off 2026-10-12 (good enough; will need tweaks when wired in Card 5).
- 3D mockup map, for tweaking (`poc/wheel3d.html` unless noted):
  - Hover: `shapeOf`/`hoverScores`/`bodyAt` (screen ellipse incl. footprint, score <1 = inside, 20% stickiness); "hit areas" toggle draws them.
  - Highlight: `hlStep` (fresnel rim, floor halo, gold ring sized from `e.half`, capped at the square; ~100 ms snap); "Highlight" panel, saved in localStorage `wheel3d.hl`.
  - Markers: equal world stems (`STEM_W`, Line2, dashed when hidden), icon on the stem top, label always above (wheel-caption style); tracing a stem (≤11 px) holds hover, gold + spark; last 15% of a trace blends into icon mode (`pre`, traced icon pinned), others' growth locked to `trace.lock`; top of stem → icon mode (spread layout behind `SPREAD`, currently off; hovered icon 1.3×); slide down from the last hovered icon to trace back out (`traceDown`, `stemT`).
  - Pip wheel (`poc/pip-wheel.js`): icons on a hexagon, title caption under each, details in one tooltip; unfolds out of the picked entity's icon (`WHEEL_S` .8), stacked between the other icons and that icon (`pw.el` z); clicking the icon deselects; the others drop to a lower plane (`LOW`, `m.low`). Folds past the ring (+`GRACE` 10): icons fan in to one line and slide under the icon; unfolding rushes out along a line aimed at the pointer, then fans out (`UNFOLD_MS`/`FOLD_MS`, `S.u`). Clicking inside the ring re-picks a square-mate (`onInnerClick`).
  - Rook (`me`) is selectable: self wheel, status strip `.rk`, full sheet in `#card`, movement spent by moves.
  - Controls: LMB drags the ground, RMB orbits, wheel zooms; pills grey out while dragging.
  - Work style: small edits directly; bigger ones go to a Sonnet with a precise spec, one agent per file at a time.
- Side projects (atomic history, council, recognition, sword icons, codex) are parked on their own branches and in `git stash`; keep them off `playable-1`.
- HUD (Card 3): one `.float.hud` bottom-left (`drawAct`/`drawTurn` fill it; turn strip is `#turnSec` inside it); Character tab = `#sheet` in the sidebar, localStorage `sideView`. Party view now carries `resources` and `char`.
- Card 4: `#look` is one `.ecard` (`cardHtml()`); hover preview + `#hovchip` via `hoverCell`/`hoverCache` (cleared in `refresh()`). No hit % (would leak AC). Click selects, double-click focuses: `selectRef(ref, src)` / `focusRef(ref)` for creature ids and cells, from portraits, 2D tokens, 3D models (`onSelect`) and any `[data-ref]` (log name/cell chips via `linkRefs`, ids from entry data, unique names only, never ids the viewer lacks). Timed clicks (400 ms), not dblclick. 3D cell focus is a no-op until `map3d.focus` takes cells.
- Card 6 done: entries carry `n` (line number), state carries `game`; viewer playback is one queue (`pb`, `ingest`/`runPlayback`/`playItem` in viewer.html; map3d `glide`/`snap`/`setSpeed`), held positions via `display()`, Skip to now + speed (`animSpeed`), older log loads when the log (newest first) is scrolled to its end. 3D effects also resolve on timers so a background tab can't wedge the queue. Untested: a real EventSource reconnect.
- Card 7 done: Follow turn keys on the latest played turn entry (`followTurn` reads the display log), and `glide()` eases to the mover while following. Wall fade `fadeOccludingWalls`; ticker `#actionTicker`; `#dmResolving` via `drawResolving()`. Camera ease not yet watched in a visible window.
- Card 5a done: wheel block in viewer.html (`wheelTap` → `openWheelAt` → `enemyMenu`/`allyMenu`/`selfMenu`/`pickMenu`/`squareMenu`; leaves via `act`/`postIntent`; provoke = `'keep'` second click), `viewer/pip-wheel.js` (moved from poc; `keep`, `warn`, `sug`), `map3d.screenOf`. `wheelDefaults` parses class/spells out of the party view's `notes`/`resources` (`char` is only an id): 5b should replace that. Doors/walls get the square wheel. Not yet seen at full frame rate in a visible window.
- Port of the 3D mockup (spec: [port-wheel3d.md](port-wheel3d.md)): Phase A done (bodies `makeToken`/`applyArmor`/`ARMOR_LOOK`, highlight `HL`/`hlStep`, screen hover `shapeOf`/`bodyAt`, `selSq`, LMB pan/RMB orbit, flat checker `FLOOR_TONES` with `TEXTURED=false`; server `armorOf`, builder creatures carry `armor`). Temporary medallion sprite until Phase B markers. No creature size in `view()` yet, so no body scaling.
- Phase B done: `viewer/marks3d.js` (`createMarks`; `sync`/`hover`/`pickAt`/`step`/`screenOf`, and for C `iconOf`/`setLow`/`active`/`iconMode`/`tracing`, via `map3d.marks()`). Icons are hit by distance on the canvas, not DOM events, so pan/orbit work over them. Dashed (occluded) stems not yet seen.
- Next: port **Phase C** (wheel out of the icon), then Card **5b**, then **8**.

## Cards (in order; each fits one session)
1. [x] **Kill native dialogs + builder focus.** Replace `confirm()` at viewer.html ~1075 (end turn with the action unused) and ~1167 (move provokes) with an in-card second click ("Provokes gob1. Click again to move."). Builder: `save()` → `render()` redraws the form 500 ms after typing stops and steals focus (builder.html ~284); don't redraw `renderMain` while focus is inside it, or restore focus and caret.
2. [x] **Wheel mockup**, standalone `poc/wheel.html`, no game wiring. A 6-slot ring around a token with keys 1-6, submenu rotation (clockwise in, counter-clockwise back, ~150 ms, Back at bottom slot 4), a fan-out of 3 entities in one square with leader lines. For the user to try the feel before Card 5. Ref: wheel-lexicon.
3. [x] **Player HUD**: a docked bottom-left character card (HP ring, movement as 5-ft squares, action/bonus/reaction pips, resources) that replaces the turn panel and swallows the compose box, plus a **Character** tab next to Narration/Combat with the full sheet. Clean and minimal. Ref: plan Phase 1.1.
4. [x] **Fixed entity card** top-right of the map, plus a hover chip over tokens ("65% · 30 ft · ½ cover"). Remove the stacked inspect panel. Odds come from `/api/look`, only for ids the client already has.
5. [ ] **Action wheel, wired** (spec: [card5-wheel.md](card5-wheel.md); 5a viewer wheels, 5b player-set slots): entity and square wheels, the multi-entity fan-out from the client's own view (count 0/1/2+, no "hidden" special case), smart Strike, player-set slots 2-3 with class defaults (stored on the character, with a "Wheel" section in the builder). Ref: wheel-lexicon. Needs Card 2's feel signed off.
6. [x] **Event stream + playback.** Spec and design calls: [card6-event-stream.md](card6-event-stream.md). Two halves: **6a** server (`n` = log line number, `game` id, `/api/log?before=`, tests), then **6b** viewer (one ordered playback queue, held positions, catch-up, Skip to now, speed control, older log on scroll).
7. [x] **Turn feel**: camera eases to the active creature and yields on any pointer or wheel input; walls between the camera and focused tokens fade; monster moves glide along `data.path`; one-line ticker; a "DM is resolving…" strip; the log defaults to Story, with Details and chips.
8. [ ] **DM speed (engine)**: `auto <id>` monster turn, `next --auto`, monster opportunity attacks rolled on the move, templated flavor lines; update CLAUDE.md's turn loop. Ref: plan Phase 2.
9. [ ] **One Warren map + 3D looks**: bridge + new entryway + caves in one `goblin-warren.json` (old ones go to `encounters/old/`); pad ragged rows with rock; in 3D, rock masses for wall cells with no floor neighbour, a backdrop past the map edge, chasm depth. Ref: plan Phase 3.

## Log
- 2026-10-12: Port Phase B (Sonnet): stems, icons and labels (marks3d.js), stem tracing and icon mode; medallion sprites gone; the seated creature is labelled "you".
- 2026-10-12: Port Phase A (Sonnet): mockup bodies tinted by armor, highlight, screen-space hover, ground-drag controls, flat checker floor. Instant clicks (no 400 ms timer; double folds the wheel and focuses).
- 2026-10-12: Card 5a (Sonnet): the pip wheel wired into the viewer, 2D and 3D, entity/self/square/pick wheels, smart Strike, provoke second click, class defaults; poc server now also serves /viewer/ so the mockup still loads.
- 2026-10-12: Card 7 (Sonnet): followTurn crash fixed (stale `logKey`), camera follows the creature the queue is playing, dead tracking code gone.
- 2026-10-12: Card 6 (Sonnets, 6a server + 6b viewer): sequence-numbered log, one ordered playback queue (glide, then die, then ticker, then the log line), catch-up, Skip, ½-4× speed, scroll-back. Opus added timer fallbacks for frame-driven 3D effects.
- 2026-10-12: Wall fade seen working (tollhouse, DM view, Morrow behind the south wall). `/j/<code>` keeps extra params (`?3d`). How to run 3D headless in a cloud session added to Rules.
- 2026-10-12: Review of PR #11: Card 6 is now the event stream (sliding 80-entry window silences fx/ticker); old 6-8 renumbered 7-9. Follow turn no longer yields to plain hover or leaving the canvas.
- 2026-10-12: Double-click focus generalized (Sonnet): portraits, map tokens/models, log name and cell chips all go through `selectRef`; checked in 2D and on a 3D model.
