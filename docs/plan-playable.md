# Plan: playable, snappy, feel-good

Goal: you plus 1-3 remote friends, on laptops in 3D, play the Goblin Warren (rope bridge → entry → caves) with no dead air and no fighting the UI. We have a few hours and will play along the way, so each phase ends in something you can play.

Decisions (grill session, 2026-10-11)
- Priority: UX first, then DM speed, then map looks.
- Monsters: engine autopilot, with the DM overriding for bosses and special notes.
- Models: Sonnet runs the DM seat; escalate to Opus on purpose. Haiku/Sonnet subagents answer easy questions and write flavor, and a persistent narrator subagent (via SendMessage) keeps its context cache warm.
- Minds run everywhere, but cheap: OpenRouter or Haiku, in parallel.
- Narration is punchy: the engine writes flavor lines, and the DM speaks on crits, downs, rulings and round starts.
- Map: one continuous Warren (bridge + new entryway + caves). The 3D view should always look right.
- Minds v3: commit what passes, freeze the rest, park `poc/` and `lib/expectations-poc.js`.

Working rule: the live game uses `state.json` at the repo root, and the server reads `viewer.html` fresh on every request. Do the work on a branch and test in the sandbox (`node tools/sandbox.js …`, viewer on port 5174), so a live session never picks up a half-done viewer. Work is split into session-sized cards in [HANDOFF.md](HANDOFF.md).

---

## Phase 0: housekeeping and quick wins (~20 min)
- [ ] Run `test.js` and `test-minds.js`, then commit minds v3 on a branch. Leave the POC files out.
- [ ] **Builder focus bug**: 500 ms after you stop typing, `save()` → `render()` redraws `renderMain` and the field loses focus (builder.html:284). Skip `renderMain` while focus is inside it, or restore focus and caret afterwards.
- [ ] **Native `confirm()` dialogs** for opportunity attacks and ending the turn with the action unused (viewer.html:1075, 1167). Replace them with an in-card "Provokes gob1. Move anyway?" second click.

## Phase 1: the player HUD and turn flow (the main event, ~2 h)
Playtest findings: the turn panel, inspect card and compose box stack on top of each other and over your own token after a move. Moving takes M, then a click, then "Move here", then a native dialog. There's no "who am I" anywhere. The camera doesn't follow.

1. **One docked HUD (bottom-left)** replaces the turn panel and the compose box.
   - Character card: name and class, an HP ring that fills, movement as a row of 5-ft squares that empty as you walk, and action/bonus/reaction pips. Attacks and spells are buttons; resources are pips (Second Wind ●○). Keep it clean and minimal, with one accent color per state.
   - The compose box folds into the card ("Tell the DM…").
   - Expanding it opens a **Character tab** next to Narration/Combat with the full sheet and backstory from the builder.
2. **Fixed entity card, top-right of the map**, opposite the HUD. It shows what you know about the hovered or selected thing, plus your odds against it. It replaces the stacked inspect panel.
3. **Action wheel** (design and slot intuitions: [wheel-lexicon.md](wheel-lexicon.md)):
   - Hover: a tiny chip over the token ("65% · 30 ft · ½ cover") and a ring; the card fills in.
   - Click: a 6-slot ring around the target, keys 1-6. Submenus rotate in, with Back at the bottom. Slot 1 is smart Strike, slots 2-3 are player-set (Signature, Kit) with class defaults, then Tactics, Inspect, Move/other.
   - Square ↔ entity toggle. A square holding several entities glows them all and fans out callouts with leader lines, capped with "+N more". Hidden creatures never glow.
   - Plain floor: hover draws the route plus "20 ft · 10 left", and a click moves. Jumps and climbs show on the label.
   - Opportunity attack: the route or slice turns red, and the click becomes "click again to provoke".
   - Builder: a "Wheel" section on the sheet to set slots 2-3 (stored on the character).
4. **"Your turn" moment**: a banner, a soft chime, and a title flash when the tab is in the background.
5. **Camera**: ease to the active creature at each turn start. Any pointer-down or scroll hands control to the player until the next turn. Add a small "follow" toggle.
6. **Occlusion**: each frame, raycast from the camera to the focused and hovered tokens and fade the walls that get hit (opacity ~0.25, or a dither/screen-door shader so there's no sorting trouble). Add a token silhouette through walls (second pass with `depthTest:false`, low alpha).
7. **Monster turns you can follow**: tokens glide along `data.path` from the log, attacks draw a quick line and flash, with ~0.6 s per action. A one-line **ticker** reads "Goblin Cutter moves to the barrels… hits Rook for 6".
8. **Waiting never feels dead**: replace the small "DM BUSY" dot with a live strip ("DM is resolving Wren's jump…" from intent acks and replies, "Goblins are moving…" during autopilot).
9. **Log**: Story is the default view (narration plus hits, downs, crits and rulings, with dice folded into each line), with a Details toggle. Cheap chips: Story / Rolls / Me. Players never see `[mind]` or secret lines (verify).

## Phase 2: DM speed (~1 h)
- [ ] `auto <id>`: a deterministic monster turn in one call. It picks a target (prefers weak, close and visible ones), moves to cover or reach, attacks, retreats or flees at morale break, and reads encounter `tactics` tags and the mind's beliefs.
- [ ] `next --auto`: chains through autopilot monsters until a player, an LLM ally or a flagged boss is up, then prints one compact summary.
- [ ] When a player provokes, roll monster opportunity attacks right away (today the move just says "DM notified" and waits).
- [ ] Engine flavor lines for hit/miss/crit/down/kill: small templated pools per damage type, so there's no model call.
- [ ] Minds in combat: `mind act` for all minded monsters in parallel on cheap models, then autopilot executes.
- [ ] CLAUDE.md: the new turn loop (autopilot by default), the model-routing rules, and a narrator subagent kept alive with SendMessage.

## Phase 3: one continuous Warren that looks good in 3D (~1-1.5 h)
- [ ] Merge rope-bridge (top), a new **entryway** (switchback path, lookout nook, a trip-line or alarm gong, and the narrow crack) and the caves into `goblin-warren.json`. Retire `rope-bridge.json`, the old `goblin-warren.json` and `goblin-warren-caves.json` into `encounters/old/`.
- [ ] Pad ragged rows with rock automatically on load, so no edge ever shows as void.
- [ ] 3D rock: wall cells with no floor neighbour render as a **rock mass** (raised, rough, darker, untiled, a little height noise). Wall cells next to floor become cave walls with irregular faces, and worked stone stays tiled.
- [ ] Backdrop: ground or rock out past the map edge with fog falloff, so the map never floats in black. The chasm gets depth and a gradient instead of a hole.

## Phase 4: playtest and tune
- Play the Warren in the sandbox with two seats. Time each round, list the friction, fix the top 3.

---

## Second encounter
Still open. A good candidate is the Ruined Watchtower: height, climbing and falls show off the 3D view, and it needs no minds.
