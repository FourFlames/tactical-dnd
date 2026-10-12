# Handoff

The baton for short sessions. **Read this file and nothing else up front.** Then read only what your card points to. Keep this file under ~80 lines: replace old content, don't append essays.

## Rules (every session)
- **A live game may be running** on port 5173 from `state.json` in the repo root. Never run engine commands there, and never edit `state.json` or `log.jsonl`.
- Test in the sandbox: `node tools/sandbox.js <engine command>` (data in `.sandbox/`), and the viewer via `preview_start viewer-sandbox` (port 5174). `node test.js` and `node test-minds.js` use a temp folder on their own.
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
- Next card: **4**.

## Cards (in order; each fits one session)
1. [x] **Kill native dialogs + builder focus.** Replace `confirm()` at viewer.html ~1075 (end turn with the action unused) and ~1167 (move provokes) with an in-card second click ("Provokes gob1. Click again to move."). Builder: `save()` → `render()` redraws the form 500 ms after typing stops and steals focus (builder.html ~284); don't redraw `renderMain` while focus is inside it, or restore focus and caret.
2. [x] **Wheel mockup**, standalone `poc/wheel.html`, no game wiring. A 6-slot ring around a token with keys 1-6, submenu rotation (clockwise in, counter-clockwise back, ~150 ms, Back at bottom slot 4), a fan-out of 3 entities in one square with leader lines. For the user to try the feel before Card 5. Ref: wheel-lexicon.
3. [x] **Player HUD**: a docked bottom-left character card (HP ring, movement as 5-ft squares, action/bonus/reaction pips, resources) that replaces the turn panel and swallows the compose box, plus a **Character** tab next to Narration/Combat with the full sheet. Clean and minimal. Ref: plan Phase 1.1.
4. [ ] **Fixed entity card** top-right of the map, plus a hover chip over tokens ("65% · 30 ft · ½ cover"). Remove the stacked inspect panel. Odds come from `/api/look`, only for ids the client already has.
5. [ ] **Action wheel, wired**: entity and square wheels, the multi-entity fan-out from the client's own view (count 0/1/2+, no "hidden" special case), smart Strike, player-set slots 2-3 with class defaults (stored on the character, with a "Wheel" section in the builder). Ref: wheel-lexicon. Needs Card 2's feel signed off.
6. [ ] **Turn feel**: camera eases to the active creature and yields on any pointer or wheel input; walls between the camera and focused tokens fade; monster moves glide along `data.path`; one-line ticker; a "DM is resolving…" strip; the log defaults to Story, with Details and chips.
7. [ ] **DM speed (engine)**: `auto <id>` monster turn, `next --auto`, monster opportunity attacks rolled on the move, templated flavor lines; update CLAUDE.md's turn loop. Ref: plan Phase 2.
8. [ ] **One Warren map + 3D looks**: bridge + new entryway + caves in one `goblin-warren.json` (old ones go to `encounters/old/`); pad ragged rows with rock; in 3D, rock masses for wall cells with no floor neighbour, a backdrop past the map edge, chasm depth. Ref: plan Phase 3.

## Log
- 2026-10-12: Card 3 (Sonnet): docked HUD (HP ring, A/B/R pips, 5-ft movement squares, resources, attacks, "Tell the DM…" input) replaces the turn panel and compose box; Character tab with the full sheet. 99 tests pass; sandbox checked incl. 3D, 375 px and the End-turn second click.
- 2026-10-11: The wheel unfolds out of the entity's icon (smaller, .8); icon, stem and label stay, other icons drop lower and behind; clicking the icon deselects; fold = pips slide under the icon, unfold = rush out in a line toward the pointer then fan to the hexagon.
- 2026-10-11: Icons and labels share one layer, stacked by distance to the cursor (nearest on top); each label is one z-step above its own icon.
- 2026-10-11: Icon mode hits icons by distance (`iconHit`): 25% wider than drawn, nearest centre wins; DOM pointer events off there, clicks go through the canvas handler.
- 2026-10-11: Trace back down from the last hovered icon in icon mode (blend in reverse; an icon in the way takes over); hovered icon in icon mode grows 1.3×; calmer spark. Spread displacement off (`SPREAD = false`, crowd labels apply in icon mode); a 36-rat swarm square (H8) for trying it.
- 2026-10-11: Tracing a stem: its last 15% blends into icon mode (square-mates grow and spread around the pinned traced icon, others fade), committing at the top; other stems' growth uses the point where the trace began.
- 2026-10-11: Spark ¼ size; marker labels always above their icon (no flip in icon mode) and styled like the wheel captions; wheel captions tuck 4 px under their icon.
- 2026-10-11: Markers (Sonnet): icons ride equal world stems, no screen kinks; tracing a stem holds the hover with a gold, wider section and a spark; reaching the top spreads that square's icons (fixed-pass force layout, stems lean in world space).
