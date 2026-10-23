# The character builder

Players build characters in the browser (`/build`, reached from the home page). A character is
stored as the **choices** a player made (`characters/<id>.json`, field `build`), never as numbers.
`lib/rules.js` derives everything from those choices: the sheet the builder shows, the stat block
the engine plays (the same shape as the creatures in `encounters/`), what's left to choose, and
anything that needs the DM. The same module runs in the browser (instant feedback) and on the server
(the authority). `node test.js` checks that the starter party rebuilt from choices matches their
hand-written sheets, and that every class and subclass builds cleanly at levels 1, 3, 5, 11 and 20.

## Who does what

| | Player (browser) | Server | DM (engine) |
|---|---|---|---|
| Choices, picks, gear, persona | ✓ | validates | can suggest changes |
| Rolled ability scores and HP | asks | rolls once, keeps the result | `char <id> reroll` |
| Hand-entered ability scores | enters | | `char <id> approve scores` |
| Homebrew within the allowance | "Use it" | re-rates it | — |
| Homebrew beyond it | "Send to the DM" | | `approve` / `decline` / `suggest` a fair version (JD helps) |
| Bringing a character into a game | | | `char <id> spawn <cell>` |

The browser can't set the server's fields: `lib/chars.js` `mergeBuild()` keeps rolls and approvals
from the stored copy, and editing approved homebrew turns it back into a draft.

## Suggestions

`suggest <id> "<text>" --patch '{"path": value}'` stores a suggestion on the character. The builder
shows it as a card at the top of every step it touches, outlines the affected fields in gold, marks
suggested options "DM suggests", and previews what would change ("AC 16 → 17"). The player can
**Accept** (the patch is applied), **Decline**, or **Talk about it**: that thread reaches the DM
through `listen`, and the DM answers with `char <id> reply <sid> "..."`. Patch paths are dotted:
`species`, `class`, `subclass`, `background`, `bgBonus`, `abilities.method`, `picks.<key>`,
`gear.armor`, `gear.weapons`, `homebrew.<hbId>` (a whole homebrew object; accepting it approves it).

## Rating homebrew

The yardstick is the **feat point (FP)**. One origin feat (Alert, Tough, Skilled) is 1 FP. A general
feat, including its +1 to an ability, is 2 FP. Each kind of homebrew has a budget:

| Kind | Budget | Benchmarks |
|---|---|---|
| Origin feat | 1.0 | Tough, Alert, Skilled, Lucky, Magic Initiate, Savage Attacker |
| General feat | 2.0 | Resilient, Speedy, Sharpshooter, Great Weapon Master, Heavily Armored |
| Fighting style | 1.0 | Archery, Defense, Dueling, Thrown Weapon Fighting |
| Species trait | 0.5 | (one trait swapped for another) |
| Whole species | 1.8 | Dwarf, High Elf, Halfling, Orc |
| Common / uncommon / rare item | 0.5 / 2.0 / 3.5 | Potion of Healing; +1 weapon, Cloak of Protection; +2 weapon |
| Something else | — | the DM rates it |

Every effect is priced from a small vocabulary (`lib/power.js`, `KINDS`). Some examples: +1 to an
ability is 1.0, a skill 0.33, expertise 0.5, +1 HP per level 0.5, +1 AC 1.5, +1 to hit 1.0, +1
damage per hit 0.6, +5 ft speed 0.25. A 1st-level spell once per long rest is 0.4.

The price is then scaled by:

- **how often it applies**: always ×1, usually ×0.75, sometimes ×0.5, rarely ×0.25;
- **its scope**: ranged attacks only ×0.5, thrown weapons ×0.5, once per turn ×0.8...;
- **how often it can be used**: effects that get spent are priced per use, and a short-rest refresh
  is worth 1.75× a long-rest one. An always-on effect limited to one fight per rest is worth a third
  to a half of having it all the time.

Things the vocabulary can't express are **self-rated**: a small perk (0.25) or a combat edge (0.5),
up to 0.75 FP per element. Past that, or for a "major ability", the DM decides.

**The method is checked against the books.** `BENCHMARKS` prices official content with the same
vocabulary. `test.js` requires every benchmark to land between 0.6× and the power-creep ceiling of
its budget, except a few widely known weak options, such as Bracers of Archery, which are kept as
comparison points. The builder shows the three closest official options next to every rating
("Compare: Tough 1 FP · Alert 1 FP").

## Power creep

Slightly-better-than-the-book is welcome. Each element may cost up to **budget × (1 + creep)**
without the DM. The overages a character uses this way come out of a small **pool** (0.5 FP by
default); past it, the DM decides. The table can tune both in `homebrew.json`:

```json
{ "creep": 0.25, "pool": 0.5, "selfRatedCap": 0.75 }
```

| Verdict | Meaning | Who decides |
|---|---|---|
| under (< 0.6× budget) | weaker than official | player (the builder suggests adding something) |
| fair (0.6–1.0×) | on par | player |
| creep (1.0×–ceiling) | a bit stronger, inside the allowance | player, while the pool lasts |
| over / dm | too strong, or can't be priced | DM, with JD's help |

JD's role for homebrew is to **find the yes**: keep what the player is excited about, and turn the
dials (frequency, conditions, scope, size, cost) until the rating fits. JD then hands the DM a ready
`suggest` command that the player can accept with one click (see `.claude/agents/jd.md`, Job 3).
