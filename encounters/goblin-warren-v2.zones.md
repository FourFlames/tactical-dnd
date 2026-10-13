# Goblin Warren v2 (zone guide)

File: `encounters/goblin-warren-v2.json` (26 columns x 51 rows). It is the rope-bridge approach, a new entryway and the whole caves complex in one map. `goblin-warren.json`, `goblin-warren-caves.json` and `rope-bridge.json` are untouched.

## Coordinates

- **Rows 1-35 are the caves map with no shift**: every cell reference in `goblin-warren-caves.zones.md` (zones, doors, patrol routes, guard posts, hooks, minds, places) is still correct. Read that guide for the caves; this one covers what is new.
- New south part: rows 36-50 (row 51 is rock). Every row is the full 26 columns (A-Z, no ragged rows).
- Lighting: ambient dark; dim areas are the caves' warren (E10:V22) and grotto (B2:J8), plus the whole approach **A36:Z50** (sky glow through the chasm). `y` (deep shadow, tag `dark`) cells are dark pockets inside lit areas. Torch brazier C48 is bright within 20 ft.

## New areas (south of the caves)

1. **Near bank** (B47:Y50). Party start: rook M47, wren L48, ash N48. Camp brazier C48 (lit), crates E49-F49, O47, W48, P50, rubble G47-H47, L50, T48-U48, stalagmites K48, U49, shadow pocket M49.
2. **Rope bridge** (L41:M46, 2 wide, narrow, flammable, 30 ft). The frayed bridge from `rope-bridge.json`. Chasm B41:X46 is -30 ft (C legend).
3. **Chasm lip** (Y41:Y46, 1 wide, narrow, rubble at Y43). The quiet way over: Athletics/Acrobatics DC 10 per leg (ruling), joins the near bank at Y47 and the far landing at Y40. No one watches it.
4. **Far landing** (J40:Y40). Shadow pocket J40, stalagmite P40, rubble U40.
5. **Entry cavern** (I36:Q40 plus the west bay F37:L39). Loud route: straight up column M, left open. Quiet route: hop between the cover pieces: rubble G37, crates I37 and O38, stalagmites J36, P37, G38, R38, G39, rubble P38 and Q39, shadow pockets O37, I38, I39.
6. **Entry crack** (M34:M35, 1 wide `n`) up to the cave mouth L32:N33, then the approach cavern K24:Q31 as before.

## Cover added to the caves (40 cells; rows 1-35 otherwise unchanged)

- **Warren** (7 stalagmite/crate pieces, 4 shadow pockets): S N15, J18, O13, F17, T19; crates Q17, R18; `y` N16, K18, G18, R19.
- **Approach cavern**: S K27, P31; rubble Q28, N30, K30.
- **Stream cave**: S E24, D29; rubble C26, G30; crate G31.
- **West tunnel**: S B12, B19 (each leaves the C column open); rubble B14, B17.
- **Flank/guard post/storeroom**: crate X22, S X27, S W20, S W14, crate Z13. The pit X24, tripline X26-Y26 and column Y route are untouched.
- **Bat cave**: S P3, W3, U8; rubble R8, X6.
- **Grotto**: S E2, I4; rubble B7, D8.

New legend entries: `=` rope bridge, `y` deep shadow. Everything else is copied from the caves map.

## Routes (all path-tested with `move`, doors closed unless noted)

- **Loud**: M47 -> bridge L/M41-46 -> entry cavern column M -> M35 -> M33 -> M24 -> crack M20-M22 (130 ft straight to M21).
- **Quiet**: lip Y47 -> Y40 -> cavern shadows -> M35, then any caves route (flank tunnel R28, stream gap J28, west tunnel).
- Caves routes unchanged: west tunnel and rubble D13-E13, flooded passage H20-H23, ledge H9-O9, bat cave and bridge K5-N5, flank tunnel R28-W28 (door `flank` V18|W18 and `store` X15|X16 as before).
- Patrol routes and guard posts from the caves guide were re-tested (C10-C23, D25-H28, K17-S18, M24-P29, F5-H8, O5-Y8, I10-O9): all reachable.

## Notes

- The rope bridge has no guards now (Grall is gone); the first goblins are inside the caves. If you want an ambush, `spawn` a lookout at P40 or the lip.
- Lit cells wreck stealth: the near-bank brazier C48 and fungus patches (K24, K25, Q30...). Dim light means partial concealment only; hide in `y` pockets or behind cover.
