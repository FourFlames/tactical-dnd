# Porting the 3D mockup's look and feel into the viewer (spec)

The user prefers how `poc/wheel3d.html` looks and feels to the viewer's 3D map, and wants it ported soon. The mockup is the reference for every visual and interaction detail: copy its constants, curves and timings exactly, then adapt them to the real data. Open it with `preview_start poc` (port 5175, `/wheel3d.html`). Its HANDOFF "3D mockup map" lines name the functions.

**What we port:** Wheel mode only. **What we don't port:** Bar mode, the Highlight tuning panel (bake its values in as constants), the "hit areas" debug toggle (keep it behind `?debug`), the fake world, and `SPREAD` (it's off in the mockup).

Three phases, one Sonnet each, in order. All three touch `viewer/map3d.js`, so never run two at once. New code may go in new modules under `viewer/` (e.g. `viewer/marks3d.js`) when map3d.js would otherwise sprawl; map3d stays the owner of the scene and passes in what a module needs.

## Phase A: bodies, highlight, hover, controls (map3d.js)

- **Bodies are deliberately very simple** (the user: "extremely simple, able to display basic armor data like its color; something else will come later"). Use the capsule torso, the head sphere and the base disc, and nothing more. Show **side** on the base ring and halo (party teal, enemy rust, neutral grey). Show **armor** on the torso material: none or cloth is a matte fabric tone; light (leather, studded) is a warm brown, slightly glossy; medium (hide, chain shirt, scale, breastplate, half plate) is a dull grey metal; heavy (ring, chain mail, splint, plate) is a bright steel with clear metalness. A shield adds a small disc on one side. The server adds `armor: { kind: 'none'|'light'|'medium'|'heavy', shield: bool }` to each creature in `view()` (lib/core.js). Take it from an explicit `c.armor` if set, else from keywords in `c.notes` or `c.attacks` ("chain mail", "leather", "plate", "shield"…), else `none`. This one small server change is allowed in Phase A; add a test for it in test.js. Keep the mapping in one table so it can be retuned or replaced later.
- **Bodies replace the standee tokens** (`makeToken`: base, rim, stem, sprite medallion). Use the mockup's `body()`: a capsule torso plus a head on a dark base, coloured by side (party teal, enemy rust, neutral grey); prone lies flat; `top` and `half` are stored for hover and markers. Creature size (if the view has it) scales the body. Flying or standing on an object uses `elev`, as tokens do today. The **name or initial no longer rides on the token**: Phase B's icon marker carries it. Until B lands, keep a small temporary label sprite above the head so the 3D view stays readable.
- **The turn ring** stays (gold, pulsing). Re-check its size against the body base.
- **Highlight** exactly as the mockup's `hlStep`, with `HL0` values as constants (the user has confirmed the defaults; they may tone them down later, so keep them in one `HL` object at the top): a fresnel rim shader on the body, a floor halo, and a gold floor ring for picked or selected, sized from `half` and capped at the square. The approach grows as the cursor nears (`apL`). Square-mates get 0.55, hovered or selected 1, with the ~100 ms snap. `hlAttach` clones materials per body; dispose them on removal.
- **Hover** is screen-space, replacing the raycast `pick`: `shapeOf`/`hoverScores`/`bodyAt` (an ellipse around the projected body plus its footprint; score < 1 is inside; 20% stickiness via `STICKY`), with a line-of-sight check only for candidates. `onHover`/`onSelect`/`onCell` keep their current contracts, so viewer.html doesn't change. A cell under the cursor with no body goes to `onCell` as today.
- **The selected square** on the floor: the mockup's `selSq` (a gold fill plus an outline), shown for a picked square.
- **Controls** as in the mockup: LMB drags the ground (the floor point stays under the cursor), RMB orbits, the wheel zooms, MMB dollies. Keep follow-turn yielding on press, drag or zoom (`stopEase`). A click is still a press and release under ~5 px without movement.
- **Keep** the turn-follow ease, `fadeOccludingWalls`, glides (`glide`/`snap`; glide the body group), `shoot`/`bump`/`floatText`/`hit` (anchor on the body top), `screenOf` (it now returns the body's top centre; Phase B changes it to the icon), pings, the path line and the cursor.

## Phase B: markers (stems, icons, labels, tracing, icon mode)

- **Per creature, as in the mockup:** a world stem (`Line2` fat line, `STEM_W` above the body top, solid in front and dashed where occluded, two pieces for the gold trace), a DOM icon at its top (initial or glyph, side colour, the `.mk` styling), and a label always above the icon in caption style ("Goblin Cutter", with `<small>` for "you", "10 ft up" or "down"). Icons and labels live in one layer, stacked by distance to the cursor, each label one z-step above its icon. In a crowd only the hovered one is named.
- **Visibility:** `inView` (some part of the body or stem has a clear line from the camera). Markers fade out when fully hidden.
- **Tracing a stem** (≤ `TRACE_R` 11 px) holds hover on that creature and turns it gold, with the spark. The last 15% blends into **icon mode** (square-mates grow and the traced icon is pinned; others' growth locks to `trace.lock`). The top of the stem enters icon mode, where the hovered icon is 1.3× and `iconHit` catches pointers 25% wider than drawn, nearest centre winning. Sliding down from the last hovered icon traces back out (`traceDown`, `stemT`).
- **Icon mode is the 3D answer to a crowded square:** in 3D, picking from a crowd happens by icon mode, not the pick wheel. The pick wheel stays for 2D.
- **Hidden creatures:** the client only has what the server sent, so nothing special is needed.
- `screenOf(id)` now returns the icon's position (falling back to the body top).

## Phase C: the wheel out of the icon (viewer.html and pip-wheel)

- In 3D, the wheel unfolds out of the picked creature's icon at `WHEEL_S` 0.8. Its element goes in the icon layer, stacked between the other icons and its own (`pw.el` z). While it's open the other icons drop to the lower plane (`LOW`, `m.low`). Clicking the icon deselects. Clicking inside the ring on another body re-picks it (`onInnerClick`, as in the mockup). A square's wheel opens around the square (`squareAnchor`) with `selSq` shown.
- Your own creature is selectable (the self wheel already exists). The mockup's status strip and sheet are covered by the HUD and the Character tab, so don't port them.
- The double-click fold (from the instant-click change) still reads right: the fold goes into the icon.

## Checks for each phase

Use the sandbox only (`viewer-sandbox` on port 5174, `?3d`; seat links from `node tools/sandbox.js seats`). Compare side by side with `poc/wheel3d.html`. Check:
- hover from the side and from above;
- a creature behind a wall (dashed stem, still pickable);
- a flier above a prone creature in one square;
- a glide (does the body move?);
- the turn ring;
- the shot and hit fx landing on bodies;
- 375 px wide.

`node test.js` must keep passing. The Browser pane may be hidden (no animation frames), so judge with screenshots after forcing a render, and tell the user to look at the result in a real window.
