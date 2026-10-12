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
- Wheel mockups: `poc/wheel.html` (2D) and `poc/wheel3d.html` (3D: pick by a stem + name pill above the body, wheel opens on the pill), open with `preview_start poc` (port 5175). Waiting on the user's sign-off on the feel before Card 5.
- Next card: **3**.

## Cards (in order; each fits one session)
1. [x] **Kill native dialogs + builder focus.** Replace `confirm()` at viewer.html ~1075 (end turn with the action unused) and ~1167 (move provokes) with an in-card second click ("Provokes gob1. Click again to move."). Builder: `save()` → `render()` redraws the form 500 ms after typing stops and steals focus (builder.html ~284); don't redraw `renderMain` while focus is inside it, or restore focus and caret.
2. [x] **Wheel mockup**, standalone `poc/wheel.html`, no game wiring. A 6-slot ring around a token with keys 1-6, submenu rotation (clockwise in, counter-clockwise back, ~150 ms, Back at bottom slot 4), a fan-out of 3 entities in one square with leader lines. For the user to try the feel before Card 5. Ref: wheel-lexicon.
3. [ ] **Player HUD**: a docked bottom-left character card (HP ring, movement as 5-ft squares, action/bonus/reaction pips, resources) that replaces the turn panel and swallows the compose box, plus a **Character** tab next to Narration/Combat with the full sheet. Clean and minimal. Ref: plan Phase 1.1.
4. [ ] **Fixed entity card** top-right of the map, plus a hover chip over tokens ("65% · 30 ft · ½ cover"). Remove the stacked inspect panel. Odds come from `/api/look`, only for ids the client already has.
5. [ ] **Action wheel, wired**: entity and square wheels, the multi-entity fan-out from the client's own view (count 0/1/2+, no "hidden" special case), smart Strike, player-set slots 2-3 with class defaults (stored on the character, with a "Wheel" section in the builder). Ref: wheel-lexicon. Needs Card 2's feel signed off.
6. [ ] **Turn feel**: camera eases to the active creature and yields on any pointer or wheel input; walls between the camera and focused tokens fade; monster moves glide along `data.path`; one-line ticker; a "DM is resolving…" strip; the log defaults to Story, with Details and chips.
7. [ ] **DM speed (engine)**: `auto <id>` monster turn, `next --auto`, monster opportunity attacks rolled on the move, templated flavor lines; update CLAUDE.md's turn loop. Ref: plan Phase 2.
8. [ ] **One Warren map + 3D looks**: bridge + new entryway + caves in one `goblin-warren.json` (old ones go to `encounters/old/`); pad ragged rows with rock; in 3D, rock masses for wall cells with no floor neighbour, a backdrop past the map edge, chasm depth. Ref: plan Phase 3.

## Log
- 2026-10-11: 3D wheel try-out `poc/wheel3d.html`: pills show near the cursor and only in line of sight; pills in a shared square push apart (replaces the 2D fan-out), >6 → "+N more".
- 2026-10-11: Card 2 done: `poc/wheel.html` (6-slot ring, keys 1-6, spin in/out, Back at 4, Shift for full attack list, 3-entity fan-out, 9-rat "+N more"). Added `poc` to launch.json.
- 2026-10-11: Card 1: in-card second clicks for unused-action End turn and provoking moves; autosave preserves the focused builder editor. 227 tests passed; sandbox UI verified (including continued typing after save). Screenshot: `screenshots/card-1-confirmation.png`.
- 2026-10-11: Grill session; plan + wheel lexicon written; branch `playable-1` pushed with the work so far and the sandbox.
