# Playtest notes

Running list from play sessions, newest first. Turn the ones worth doing into cards in HANDOFF.md.

## 2026-10-13: goblin-warren-caves in the sandbox, user plays Rook, Wren and Ash on one seat

3. *(spotted by Claude)* After `load`, the Story tab still shows the previous game's player messages ("tester (Rook): test hi", Action Surge...) between the new intro lines. Old intents seem to leak into a fresh game's story; they should belong to the game they were sent in. The "DM is resolving…" strip also sat there with nothing pending.
2. **Placeholders for the void / unseen.** In 3D at the landing you get a few lit squares floating in pure black, with the column letters A-Z strung across the dark on their own. It's jarring. Wanted: something in place of the unknown, e.g. a dim fog or rough rock mass over unseen cells, a faint edge where known turns into unknown, and the axis labels hidden or tied to what's known. (Overlaps Card 9's "rock masses / backdrop past the map edge".)
1. **Move with the wheel out of combat.** Everything on the wheel keys off `myTurn()` (viewer.html ~1373), which needs a turn order, and the server's turn helper (server.js ~23) returns null without one. So before initiative a seated player can't move at all except by asking the DM. Wanted: before initiative, the selected seated creature (one seat can hold several) can move/sneak/open doors from the wheel. No turn budget, but an exploration step stays one round's worth of movement, and the DM `tick`s.
