# Goblin Warren: Caves (zone guide)

File: `encounters/goblin-warren-caves.json` (26 columns A-Z x 36 rows, the engine's maximum width). The original `goblin-warren.json` is untouched.

## Coordinates

- Cells are letter + row, A1 top-left. Columns A-Z, rows 1-36. Row 1 and 36, columns A and the east edge are rock.
- The original warren was stamped in with every cell shifted **+4 columns, +9 rows** (old I11 is now M20). Warren interior is F11-U19; its walls are rows 10 and 20, columns E and V.
- Heights come from legend `elev`, not a heights grid: high ledge `e` is +10 ft, chasm `C` is -30 ft, everything else 0.
- Lighting: ambient **dark**; **dim** areas: warren (E10:V22) and grotto (B2:J8). Anything with `fire-source` (cookfire, braziers) is bright within 20 ft; `m` glowing fungus is `lit`; `V` bat roost is `dark`. Torch-carrying creatures can use `light: 20`.
- Pathing was tested with every route below (doors opened). Row numbers below are the row as printed by `show` (1-based).

## Original creatures (shifted)

rook M21, wren M20, ash M22 (inside the crack, party start). snikka L12, gob4 Pip L18, gob5 lookout U15 (rock shelf T15-U16), gob6 I13, gob7 K15, marta Q12, tam S12 (pen P12-T14, gate R14). Cookfire J14, oil barrels G16-H17, bedding G11-H12, rubble N17-O18.

## Zones

1. **The Warren** (F11-U19). Unchanged chamber. Entrances: front crack M20-M22; flooded passage H19 (south wall, via H20-H23); rubble tunnel E13 (west wall); ledge drop I10/J10 (north wall, 10 ft above floor I11/J11); flank door V18 (east wall); hidden slab door at U14|V14 (east wall, by the pen).
2. **Approach Cavern** (K24-Q31, throat L23-N23, landing L32-N33, rope-bridge exit M34-M35). Where the crack opens south. Hub for the three side routes: west gap J28 (`n`), east tunnel R28.
3. **Flooded Cave / Stream** (C24-I31). West of the approach. Shallow stream C27-I28 (water, slick), pond H24-I26, deep pool C30-D31, **flooded passage H20-H23** (deep, narrow, under the warren wall to H19). Slick moss E25-F25, E26.
4. **West Tunnel** (B9-C23, 2 wide). Runs from the grotto to the stream cave. Sleeping nook D15-D18 (cots D15-D17), goblin midden B20-D22 (floor C20, C22), **collapsed rubble D13-E13** (shortcut into the warren's west wall).
5. **Mushroom Grotto** (B2-J8). Fungus garden, dim. Exits: south to the West Tunnel (B9-C9), east across the bridge, southeast climb onto the ledge (H9).
6. **Chasm, Bridge and High Ledge**. Chasm K2-N8 (-30 ft). **Rotten plank bridge K5-N5** (narrow, flammable) joins grotto J5 to bat cave O5. **Ledge** H9-O9 at +10 ft: reached by climbing from grotto H8 (or from bat cave O8, climb); the lip cells I10 and J10 look down into the warren.
7. **Bat Cave** (O2-Y8, dark). Roost R3-U4, guano Q5-U6. Only exits: the bridge (west), the ledge climb (O8-O9), and the narrow stalactite chokepoint Y9-Y10 south to the storeroom.
8. **Storeroom** (W11-Z15) with the hidden alcove V14. Loot and powder.
9. **Flank Tunnel and Guard Post**. Tunnel R28-W28 (narrow R-T), corridor X22-Y28, guard post W16-Y21 (torch-lit). Door **flank** (V18|W18) into the warren; door **store** (X15|X16) up to the storeroom.

## Environmental features

| Cell(s) | Legend / tag | Intended use |
|---|---|---|
| J14 cookfire | impassable, fire-source, can-topple | original; light source |
| G16-H17 barrels | explosive, flammable | original: 3d6 fire blast |
| G11-H12 bedding, pen P12-T14 | flammable | original |
| D13-E13 `R` collapsed rubble | difficult, cover-half, can-topple | west shortcut; clearing/crossing is noisy; pulling it down could re-seal the tunnel |
| H20-H23 `W` flooded passage | water, narrow (depth 5) | swim route under the wall; Athletics DC 10 or hold breath, no light, arrows/gear soaked; DM ruling |
| C27-I28, H24-I26 `w` stream | water, slick | difficult; DM may rule the gurgle masks footsteps for sneaking (`noise` does not model it) |
| E25-F25, E26 `:` moss | slick | Acrobatics DC 10 or fall prone |
| K5-N5 `B` bridge | bridge, narrow, flammable | rotten: DC 12 Acrobatics/Dex each crossing when carrying heavy armour or running; fail = planks break, `fall` 30 ft; burn it to cut the route |
| K2-N8 `C` chasm | chasm, impassable, -30 ft | jump (`--jump`) or `fall <id> <cell> --feet 30` |
| H9-O9, I10, J10 `e` ledge | high-ground, +10 ft | overhead route; fire arrows into the warren; drop with `fall` to I11/J11 (1d6) or rope |
| B3-C4 `M` marsh-gas hollow | difficult, flammable, explosive | methane: a spark detonates (`damage ... fire --save dex --dc 13`, 10 ft radius); farmer keeps open flame away |
| F4, G4, F5, G5, I6 (grotto); D25 (stream cave); K24, K25, Q30 (approach); P7, X4 (bat cave) `m` | lit | glowing fungus patches: lit cells wreck stealth and give the party light to read by |
| D6-F7, H4 `j` mushroom beds | difficult, flammable, cover-half | farm; hiding spot (cover) |
| E6-G6 top edge (`low` wall) | low wall | fence around the beds |
| O2, Y2, W7, S7, B2, J2, J8, O26, P26, L29, Q24, C24, F30, I31 `S` | impassable, cover-half | stalagmites: hiding and cover |
| X9 `T` stalactite cluster | can-topple, cover-half | topple onto Y9-Y10 to seal/crush the bat-cave/storeroom chokepoint (DEX save, 2d6 + blocked) |
| R3-U4 `V` roost | dark | bats: loud noise within ~40 ft of the roost should wake the colony (DM ruling, spawn a swarm/`noise` at the cave that wakes goblins) |
| Q5-U6 `G` guano | difficult, slick | slow, slippery, smelly |
| B20-D22 `d` midden | difficult, flammable | slow; scent (`mind setup senses.scent`); scavenger hides in it |
| D15-D17 `h` cots | difficult, flammable | sleeper |
| X24 (hidden, plain floor) | **spiked pit** | first creature to step in: DEX DC 13 or `fall <id> --feet 10` (1d6 + spikes 1d6 piercing); `terrain X24 add pit` once revealed. NPCs know to skirt it |
| X26-Y26 (hidden, plain floor) | **tripline and bell** | stepping through: `noise Y26 "a sharp bell clangs" --loud 80`; Perception DC 13 to spot; the guard post hears it |
| T27 `q` wedged boulder | impassable, opaque, cover-3q, can-topple | above the flank tunnel (S28-U28): cut the prop and it rolls into the tunnel (Dex DC 14, 3d6; blocks the passage with rubble) |
| Y17 `F` brazier | fire-source | torch-lit guard post; tip it onto crates (W16, Y21) |
| W16, Y21, Y14, Z11, Z12 `k` crates | climbable, flammable, cover-half | loot (storeroom crates Z11-Z12, Y14) |
| W11-W12 `K` powder kegs | explosive, flammable, can-topple | goblin blasting powder: bigger blast than the warren barrels (4d6) |
| Y19 `t` table | difficult, cover-half | guard post |

## Doors

- **flank** (V18|W18) closed, wooden. Warren east wall; leads to the guard post.
- **store** (X15|X16) closed. Guard post north wall; leads to the storeroom.
- **secret** (U14|V14) closed and hidden (Perception DC 15 from the storeroom side or the pen side). Opens the warren's NE corner onto the storeroom alcove. `door secret open --force` after the ruling.
- Cave mouths have no doors: the bridge, the ledge and the tunnels are open.

## Chokepoints

- Front crack M20-M22 (1 wide). Stream gap J28 (1 wide). Flank tunnel R28-T28 (1 wide). Chokepoint Y9-Y10 (1 wide, stalactites). Flooded passage H20-H23 (1 wide, underwater). Bridge K5-N5 (1 wide). Rubble D13-E13 (difficult).

## Patrol routes (tested pathable, loops; legs are autopathed)

1. **East flank**: X17 area: `Y22, Y25, Y27, S28, P29, S28, Y27, Y22` (about 190 ft loop). Keep to column Y to avoid the pit at X24.
2. **Stream**: `D25, H25, H28, D28, D25` (105 ft).
3. **West tunnel**: `C10, C13, C19, C23, C13` (140 ft).
4. **Grotto farm**: `F5, E8, H8, H4, F5` (75 ft).
5. **Bat rim**: `O5, L5, O5, W6, Y8, W6, O5` (140 ft). Crosses the bridge.
6. **Ledge watch**: `I10, K9, O9, K9` (60 ft).
7. **Warren inner**: `K19, P19, S18, P17, K17` (90 ft).
8. **Approach**: `M24, P27, M30, L25` (70 ft), just outside the crack.

## Guard posts (cell, facing)

- Flank post: **X17 facing S** (torchlit by Y17; sees the corridor, pit and tripline), second at **W18 facing W** (watches the flank door).
- Lookout (original) T15/U15 on the rock shelf facing W/SW.
- Bridge: **O5 facing W** (the bat-cave end of the bridge, dark).
- Stream: **H25 facing S** (the pond, covers the flooded passage mouth).
- Crack ambush: **O26 facing W** behind stalagmites (hidden, watches the crack throat L23-N23).

## Hiding spots

Stalagmite clusters (cover-half): O26, P26, L29, Q24, C24, F30, I31, O2, Y2, W7, S7, B2, J2, J8. Crates/kegs: W16, Y21, Z11-Z12, W11-W12. Beds D6-F7. Midden B20-D22. Cots D15-D17. Deep pool C30-D31. Roost R3-U4 (dark). Dark tunnels are everywhere; fungus and braziers are the bright spots to avoid.

## Suggested new goblins

1. **East post sentry** (minion): X17, facing S, `post X17`, torch `light: 20`.
2. **East patrol** (minion): start Y27, patrol route 1.
3. **Trapper** (elite, knows pit and tripline): Y25, hidden behind the corridor bend, post Y25 facing S. Resets the tripline.
4. **Shaman** (elite or commander): storeroom X13, facing E, with the powder kegs. Smokes mushrooms.
5. **Bat-cave watcher** (minion): Q7 (guano), facing E; bored, hates the bats; `noise` here wakes the colony.
6. **Mushroom farmer** (minion, non-combatant): G7, route 4; flinches at fire (methane).
7. **Bored sleeper** (minion, `asleep`): D16 on the cots, `post D16`.
8. **Stream fisher / midden scavenger** (minion, keen scent): C21 in the midden or F28 wading, route 2.
9. **Ledge archer** (optional): K9, facing N-S sweep, route 6.

## Engine limitations noticed

- Maximum width is 26 columns (cells are one letter A-Z), so the map is 26 x 36.
- No hidden-trap or tripline primitive: both are plain floor and must be run by ruling; `terrain <cell> add pit` marks a pit once revealed.
- Sound dampening by water and bat-waking are not modelled (use `noise` and rulings).
- Falls from the ledge into the warren are handled by `fall`; pathing treats the drop as a climb-down.
