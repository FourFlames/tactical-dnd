# Action wheel lexicon

> **This is a scratchpad, not a source of truth.** The code decides what the wheel does. This file records the *intuitions* behind slot positions, so anyone tinkering with the menu can see which habits a change might break. If the code and this file disagree, the code wins, and this file should be updated (or the disagreement noted here).

## Principles

- **A slot's meaning is stable; its contents vary.** Slot 1 is always "Strike." Whether that means a longsword or Fire Bolt depends on range and the character. Players learn positions, not labels.
- **Same position, same role, whatever the target.** Slot 1 is the primary verb on every wheel (Strike an enemy, Help an ally, Open a door). Inspect is always in the same spot.
- **Every slice shows what it will actually do.** Show the chosen content and its odds ("Longsword · 65%"), never just the role name.
- **Shift-click or hold** on a smart slice opens the full list behind it (every weapon or cantrip) to override this once.
- **Two levels at most.** Root → category → done. A third level becomes an inline choice on the slice or in the fixed card.
- **Back is always slot 4 (bottom, 6 o'clock)** inside a submenu, so a submenu has slots 1, 2, 3, 5 and 6 for content. Esc, Backspace and right-click also mean back, and close the wheel at the root.
- **Rotation encodes depth.** Drilling in spins clockwise and back spins counter-clockwise, ~150 ms, and input is never blocked mid-spin.
- **Keys 1-6 map to fixed clock positions**, the same on every wheel and level.

## Positions

Clock layout, starting at the top and going clockwise:

```
        1
    6       2
    5       3
        4
```

(Six slices; 1 is at 12 o'clock and 4 is at 6 o'clock. Inside submenus slot 4 is Back: down means back.)

## Wheel types

### Entity wheel: enemy

| Slot | Role | Fits here | Examples |
|---|---|---|---|
| 1 | **Strike** (smart) | The best default attack against this target from here | Longsword when adjacent; javelin at 20 ft; Fire Bolt at 90 ft |
| 2 | **Signature** (player-set) | The move this character reaches for most | Approach & strike, Second Wind, Cunning Action: Hide, Rage, Flurry |
| 3 | **Kit** ▸ (player-set, usually spells) | The character's main toolbox | Spells ▸, Maneuvers ▸ (Battle Master), Ki ▸ |
| 4 | **Tactics** ▸ | Universal combat options against a creature | Shove, Grapple, Help, Disarm, Ready |
| 5 | **Inspect** | Learn about it; fills the fixed card | (one click) |
| 6 | **Move / other** ▸ | Movement relative to this creature, items | Approach, Move adjacent (flank), Throw item |

### Entity wheel: ally

| Slot | Role | Examples |
|---|---|---|
| 1 | **Aid** (smart) | Help action; Healing Word if they're down; stabilize (Medicine) if dying |
| 2 | Signature | Same pick as on the enemy wheel; greyed if it can't target an ally |
| 3 | Kit ▸ | Buff spells first (Bless, Shield of Faith) |
| 4 | Tactics ▸ | Drag/carry, hand an item, swap places |
| 5 | Inspect | |
| 6 | Talk / other ▸ | Speak, whisper, signal |

### Entity wheel: object / door / feature

| Slot | Role | Examples |
|---|---|---|
| 1 | **Use** (smart) | Open/close a door, climb crates, light a brazier |
| 2 | Signature | Usually greyed |
| 3 | Kit ▸ | Spells that target objects (Fire Bolt the oil, Mage Hand) |
| 4 | **Try something** ▸ | Topple, break, push, cut (each becomes a ruling or `offer`) |
| 5 | Inspect | Investigation/Perception for more |
| 6 | Other ▸ | |

### Square wheel

| Slot | Role | Examples |
|---|---|---|
| 1 | **Move here** (smart) | Walk; marks itself "jump" or "climb" when the route needs it |
| 2 | Dash here | Dash + move in one |
| 3 | **Aim here** ▸ | Area spells centred on the square, thrown flask |
| 4 | Movement tricks ▸ | Jump, fast climb, vault, drop prone, sneak there |
| 5 | Inspect square | Terrain, height, cover, what's lying there |
| 6 | Ping / tell the DM | Point it out to the table |

Plain floor doesn't need the wheel: hover shows the route and a click moves. The square wheel is for when you want more than walking.

## Player-set slots

- The **Signature** (slot 2) and **Kit** (slot 3) slots are set in the character interface. Their meaning ("my go-to move," "my toolbox") is stable; the contents are the player's choice.
- Defaults come from class and subclass. They're starting points, not rules:

| Class | Signature (2) | Kit (3) |
|---|---|---|
| Fighter | Approach & strike | Second Wind ▸ / Maneuvers ▸ (Battle Master) |
| Rogue | Cunning Action: Hide | Cunning Action ▸ |
| Barbarian | Rage | Reckless strike ▸ |
| Monk | Flurry of Blows | Ki ▸ |
| Paladin | Approach & strike | Spells ▸ (Smite on the strike slice) |
| Ranger | Hunter's Mark target | Spells ▸ |
| Cleric | Main cantrip (Sacred Flame) | Spells ▸ |
| Wizard / Sorcerer / Warlock | Main cantrip | Spells ▸ |
| Bard / Druid | Main cantrip | Spells ▸ |

- A self-targeted Signature (Second Wind, Rage) shown on an enemy wheel gets a "self" mark, so it's clear it won't hit the goblin.

## Square ↔ entity

- A toggle (button, with keys M / P as today) switches the click target between **square** and **entity**.
- Switching from square to entity when the square holds several things (a flier above a prone ally, an item on a corpse) makes **every known entity in that square glow** and fans out one small callout per entity. Each callout sits near its entity with a leader line back to it and is chosen with a click (or key 1-6). Callouts avoid covering each other and their tokens; layout is best effort, not a guarantee.
- Past ~6 entities: show the first few (nearest the camera, or hostile first) and a "+N more" callout that opens a list. Never let a crowded square take over the screen.
- **Only what the viewer knows about glows**, and this holds by construction, not by a check. The client works only from the view the server sent (`C.view`, built per viewer), counts the entities in the square, and branches on that count: 0 → square wheel, 1 → that entity's wheel, 2+ → fan-out. Nothing special-cases "hidden," because hidden creatures were never sent. Server lookups (`/api/look`) are made only for ids the client already has, never as a probe of "what's in this square?"

## Open questions

- Should Approach & strike be a default in slot 2, or always available under slot 6?
- Should the square wheel open on click, or only on a modifier, with a plain click always moving?
- Drag-to-rearrange the root, or only player-set slots 2-3?
