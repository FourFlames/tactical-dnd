# Card 5: the action wheel, wired (spec)

Two halves: **5a** puts the wheel into the real viewer with class-default slots, and **5b** makes slots 2-3 player-set (stored on the character, with a "Wheel" section in the builder). References: [wheel-lexicon.md](wheel-lexicon.md) for slot roles, and the signed-off mockup `poc/wheel3d.html` with `poc/pip-wheel.js` (open with `preview_start poc`, port 5175). The mockup is the source for look and feel; this file is the source for wiring.

## Design calls for 5a (decided)

- **Reuse the pip wheel as it is.** Move `poc/pip-wheel.js` to `viewer/pip-wheel.js`, and change `poc/wheel3d.html`'s import to `../viewer/pip-wheel.js` so the mockup keeps working. viewer.html is a classic script, so load the wheel with `import('/viewer/pip-wheel.js')` the way map3d is loaded (check that the server serves it). Only change the module where the wiring needs it (the `keep` leaf below), and keep its API documented in its header comment.
- **Don't port the mockup's hover stems, icon mode or spread layout.** The viewer already has a hover chip, a ring and the entity card. The wheel opens on a click, anchored on the target's screen position.
- **Who gets a wheel:** a seated player (`TOKEN` plus a seat). The DM view and spectators keep today's click-selects behaviour. Off your turn the wheel still opens: leaves that need your turn (attack, move, dash…) are greyed with "not your turn", and declared actions (intents) are still allowed, since the server notes them as your plan.
- **Opening:** a single click (after the existing 400 ms single/double split in `selectRef`) on something on the map opens the wheel, and still selects it so the entity card fills. A double-click still focuses the camera and doesn't open the wheel. Esc, a click on empty space outside the ring, or a click on the target closes it (the pip wheel already does this).
- **What the click hits.** Count the creatures the client's own view has in that square (`state.creatures`, matching `pos`): 0 → the square wheel; 1 → that creature's wheel; 2+ → a **pick wheel** whose slots are the entities (names and icons, keys 1-6; past 5, slot 6 is "+N more ▸"), and picking one opens its wheel. This is the fan-out, built from the pip wheel instead of the mockup's leader lines. Nothing special-cases hidden creatures: the server never sent them. A door or wall the player clicked (if the viewer can tell) gets the object wheel; otherwise the square wheel covers it.
- **Anchors:** in 2D, the token or cell centre in client px, from the SVG's `getScreenCTM`. In 3D, add `map3d.screenOf(ref) → { x, y, r }` (project the token's or cell's centre; `r` is the on-screen radius). Poll it from the anchor function so the wheel follows a camera ease.
- **Every leaf does something real, through paths that already exist.** Use only these two:
  - `act(action, extra)` for what `/api/act` can do: `attack {target, weapon, sneak}`, `move {cell, jump, fastClimb}`, `dash {as}`, `disengage {as}`, `dodge`, `hide {as}`, `check {skill, about}`.
  - `postIntent({ text, target | cell })` for anything else, where the DM rules (Shove, Grapple, Help, Ready, Second Wind, casting a spell, Throw, Drop prone, Sneak there, Aim here…). Word the text as the character's declaration: "Rook tries to shove the Goblin Cutter off the bridge" (use real names).
  Don't add server actions in 5a.
- **Slot 1 is smart.**
  - **Strike** uses `look.attacks` for that target (the `/api/look` result the entity card already fetches): the first `ok` attack without disadvantage, else the first `ok` one. The caption is the weapon; the tooltip has range, adv/dis and damage. Sneak Attack is on when offered. `full()` (shift-click) lists every attack. Greyed with the reason when none is ok or the action is spent.
  - **Aid** on an ally: Help, or "Stabilize (Medicine DC 10)" as a `check` when they're at 0 HP.
  - **Move here** on a square uses `/api/path` (the existing `updatePath`/`pathData` logic): the caption shows "20 ft", and "Jump here"/"Climb here" when the route needs it. If the move is too far but a dash covers it, slot 1 still says Move and slot 2 Dash here is the hot suggestion.
- **Opportunity attacks: second click.** When a move provokes, the slot turns red with "Provokes Grall". The first choose keeps the wheel open and the second commits, matching the existing `secondClick`. To make that possible, add one option to the pip wheel: if `onLeaf` returns `'keep'`, the wheel stays open and re-renders that slot (the leaf object may have changed its `what`/`odds`/`warn` fields). Style `warn` slots with a red ring.
- **Slots 2-3 (Signature, Kit) in 5a:** a class-default table in the viewer (from the lexicon), read from the party view's `char` (class and subclass). Only wire what has a real path, using `act` or an intent:
  - **Fighter:** Approach & strike (move adjacent, then attack; two calls, the second only if the first succeeds) / Kit: Second Wind (intent), plus Action Surge (intent) if present.
  - **Rogue:** Hide as a bonus action (`act('hide', {as:'bonus'})`) / Kit: Cunning Action ▸ Dash, Disengage, Hide (all `as: 'bonus'`).
  - **Spellcasters:** their first attack cantrip as an intent ("casts Fire Bolt at …") / Kit: Spells ▸ from the character's spell list, as intents (pages via slot 6 "More ▸" when there are more than 5).
  - **Anything else:** an intent with the lexicon's default name.
  Put the table in one place (`wheelDefaults(char)`) so 5b can swap it for the stored choice. A self-targeted Signature shown on an enemy wheel gets the "self" mark.
- **Inspect (slot 5)** selects the target (entity card) and sends the existing inspect intent (kind `inspect`), as the card's Ask button does today. **Ping (square slot 6)** reuses `sendPing`.
- **Keys:** 1-6 while the wheel is open (the pip wheel handles them). Don't break existing shortcuts (M/P mode, etc.) while it's closed.
- **The HUD and entity card buttons stay.** The wheel is a faster path, not a replacement, in 5a.

## Slots, as built in 5a

Enemy: 1 Strike · 2 Signature · 3 Kit ▸ · 4 Tactics ▸ (Shove, Grapple, Disarm, Help an ally against it, Ready, Dodge) · 5 Inspect · 6 Move ▸ (Approach = nearest free adjacent square by path cost, Disengage, Dash).
Ally: 1 Aid · 2 Signature (greyed if it can't target an ally) · 3 Kit ▸ · 4 Tactics ▸ (Drag, Hand item, Swap places: intents) · 5 Inspect · 6 Talk ▸ (Speak, Whisper, Shout: these open the "Tell the DM…" box prefilled, e.g. `Rook says to Wren: "`, with focus in it).
Self (your own token): 1 Dodge · 2 Signature · 3 Kit ▸ · 4 Hide · 5 Inspect (your Character tab) · 6 End turn (with the existing "action unused" second click).
Square: 1 Move here · 2 Dash here · 3 Aim here ▸ (intent) · 4 Tricks ▸ (Jump = move with jump, Climb fast = move with fastClimb, Drop prone and Sneak there as intents) · 5 Inspect square · 6 Ping.

## Verify (5a)

Sandbox only (`node tools/sandbox.js`; `seats` prints seat links; `preview_start viewer-sandbox`, port 5174). On rope-bridge, with a seated party member on their turn, in both 2D and `?3d`:
- Strike an adjacent goblin with key 1. Shift-click opens the full attack list.
- A square wheel move with a provoking route: red slot, second click commits.
- Dash here when only a dash reaches.
- The pick wheel on a square holding two creatures (spawn or move one onto another's square if the rules let you; otherwise test with a prone or flying creature).
- Off-turn greying.
- The Esc, Back and right-click paths.
- Rogue Hide as a bonus action, and a spellcaster's Spells ▸ intent.
- 375 px wide doesn't break.
- `node test.js` passes.

## 5b (next session, sketch)

- Store `wheel: { signature, kit }` on the character (`lib/chars.js` build, validated against what the character has).
- Add a "Wheel" section in builder.html to pick them, with class defaults shown.
- The viewer's `wheelDefaults` reads the stored choice first.
