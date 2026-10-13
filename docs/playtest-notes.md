# Playtest notes

Running list from play sessions, newest first. Turn the ones worth doing into cards in HANDOFF.md.

## 2026-10-13: goblin-warren-caves in the sandbox, user plays Rook, Wren and Ash on one seat

Paused at round 3, Mogwa's turn (Wren owed her round-3 turn after a DM slip). Snikka, Gix and Nub down; Pip and Bog on the ledge; the rest of the warren at its posts.

### Post-mortem
- **What worked.** Exploration → alarm → initiative flowed from the minds on their own (Pip spotted Rook and the warren armed itself). The wheel was usable for a whole fight once the fixes below landed; the full-window overlay layout was a clear win ("I like this so much better"). Undo, OA offers and action costs now behave like the rules.
- **What hurt the player.** Things the UI allowed that the rules don't (Spiritual Weapon on the action, Sacred Flame after the action was spent), wheels that clung or didn't open, layout jumps, a void map at the start, and waiting on the DM between turns.
- **What hurt the DM (me).** Running the turn order by hand: shell loops of `mind act` + `next` (and one too many `next` skipped Wren), noisy mind output to grep, reading `state.json` to check a turn tracker, no lever for a rout, opportunity attacks rolled after the fact, hide totals judged by guess. Direction from the user: make turn flow almost entirely engine; the DM rules and narrates.
- **Fixed during the session** (commits a5a489b..e28528a): notes 1-9, 15, 17, plus the wheel not opening after a folded one, labels/ring by zoom, initiative strip placement, route preview on move slots, double-click a square to focus, wheel above panels.
- **Open → cards:** 10, 16 and the DM list → Card 8; 12 → Card 9; 13, 14 → Card 10; 11 and doors → Card 11; unverified checks → Card 12.

### Notes
17. **Reaction visible off-turn; OAs are the player's choice.** Done: reaction pip shows off-turn; a provoked OA against a seated PC becomes an offer, `oa <id>` resolves it from the departure cell.
16. *(DM slip)* **No way back a turn.** I ran `next` one time too many and skipped Wren's round-3 turn; the engine has no `prev`/`turn <id>`, and `next` will end a seated player's turn without them. When a mind's move provoked, the OA had to be rolled by hand (fixed by 17 for player reactors).
15. **Right-click is the ring's alternate menu.** Done: right-click a slot for its alternates; in there left-click uses, right-click swaps into the slot (localStorage per character until Card 5b moves it onto the sheet).
14. **Tracks.** Survival and tracking could become really cool with creatures leaving tracks (footprints in mud/guano/blood, how old, how many, which way), read with Survival.
13. **Sound events need a source.** "Rook and Brother Ash hear a voice to the east shout..." should carry where it came from (a cell chip / direction marker on the map), as far as the hearer can tell.
12. **Stealth needs a lot of cover.** Maps for sneaking want far more cover/concealment: pillars, crates, stalagmites, dim pockets.
11. **Spiritual Weapon should get a body** on the map (a spectral token that moves 20 ft with its bonus action), later.
10. *(spotted by Claude)* **Morale breaks don't move the minds.** After Snikka fell, 7 goblins failed the Wis DC 10 and got `mind <id> notice "...your nerve breaks..."`, but kept their old plans. A rout needs a real lever.
9. **Spells on the wheel ignore the action economy.** Done: every leaf is gated by its cost; spell requests mark that part of the turn spent.
8. *(spotted by Claude)* **Spiritual Weapon spent Ash's action.** Done: attacks carry `as`; Spiritual Weapon is a bonus action and its first use spends a slot; `spend <id> <resource> [n]`.
7. **Undo should restore hiding.** Done: undo restores hiding unless an NPC spotted the mover; a second click lists what the undone move showed.
6. **Wheel ring follows the zoom.** Done: full size with captions down to a 50 px ring, then the whole wheel shrinks with the square.
5. **Full-window map, everything overlays.** Done. Unchecked: narrow windows.
4. **Clicking a traced icon must not miss.** Done: a traced/hovered icon grows and is hit at least 20 px out.
3. *(spotted by Claude)* **Old messages leaked into a new game's story.** Done: intents carry the game id.
2. **Placeholders for the void / unseen.** Done: uncharted ground under unknown cells with a soft frontier; labels follow what's known. Card 9 still owes real rock masses.
1. **Move with the wheel out of combat.** Done: explore mode (pick any seated creature, one round of movement per `tick`, Ready pings the DM). Doors still have no wheel (Card 11).
