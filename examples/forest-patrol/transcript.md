# Forest patrol: Edda, haiku-tier warden, 30 rounds (3 minutes)

Sandbox run (not the live game). Italic lines are the scripted forest; bold rounds are the engine; quoted lines are haiku deciding as Edda from her brief alone. Rounds with no quote are the deterministic fallback.

**Round 1** (Edda at H9, facing E, alarm routine 0)
  Edda moves B9 → H9 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to H9, heading for M10

_Forest (t2): An owl hoots somewhere off in the trees._
  - (routine): Heard an owl hooting, low and slow, to the north-west, a short way off (around A1, give or take 5 ft).

**Round 2** (Edda at M10, facing SE, alarm routine 11)
  Edda moves H9 → M10 (25 ft, 5 ft left).
  [fallback: Walk the patrol route] walk your patrol route → reached M10

**Round 3** (Edda at S11, facing E, alarm routine 4)
  Edda moves M10 → S11 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to S11, heading for X12

_Forest (t4): A doe steps out of the bracken ahead, near the edge of the lantern light._
  - (routine): Heard an owl hooting, low and slow, to the north-west, a short way off (around A1, give or take 5 ft). | Saw a doe, ears up in the gloom at X6.

**Round 4** (Edda at X12, facing SE, alarm routine 0)
  Edda moves S11 → X12 (25 ft, 5 ft left).
  [fallback: Walk the patrol route] walk your patrol route → reached X12
  - (routine): Heard an owl hooting, low and slow, to the north-west, a short way off (around A1, give or take 5 ft). | Saw a doe, ears up in the gloom at X6. | Lost sight of a doe, ears up (last seen at X6).

_Forest (t5): The doe bolts away into the dark._

**Round 5** (Edda at R11, facing W, alarm routine 0)
  Edda moves X12 → R11 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to R11, heading for B9

**Round 6** (Edda at L9, facing NW, alarm routine 0)
  Edda moves R11 → L9 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to L9, heading for B9

_Forest (t7): A dry branch snaps behind her. (Just a branch giving way under its own weight.)_
  - (curious): Saw a doe, ears up in the gloom at X6. | Lost sight of a doe, ears up (last seen at X6). | Heard a dry branch snapping, to the south-east, a short way off (around U18, give or take 5 ft).

**[t6] Edda stops to think** (needs a model: Heard a dry branch snapping, to the south-east, a short way off (around U18, give or take 5 ft).)
  > **Haiku (as Edda):** “The branch snap is the first real new evidence and it lies across the stream, where the doe went; I'll move to the bridge's west end under cover of the trees and watch before going closer, since it could be a deer or a poacher.”
  > belief (hypothesis, 0.4): Something moved through the brush south-east of me, near U18, and the snapped branch was not the owl or the wind. It could be the doe I lost sight of, or a person.
  > belief (hypothesis, 0.35): The doe at X6 was probably spooked by whatever is east of the stream, so it may have bolted that way.
  > belief (accepted, 0.8): The owl hooting to the north-west is just an owl, not a signal.
  > plan: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.: {"do":"move","to":"Q11"} → {"do":"watch","at":"Q11","rounds":2} → {"do":"investigate","at":"U18"}
  > alarm: curious
  Edda's decision:
    accepted: belief b7; belief b8; belief b9; alarm curious; intention i10: move to Q11; watch Q11 for 2 round(s); investigate U18

**Round 7** (Edda at Q11, facing SE, alarm curious 25)
  Edda moves L9 → Q11 (25 ft, 5 ft left).
  [model: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.] move to Q11 → reached Q11
  [model: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.] watch Q11 for 2 round(s) → watches Q11

**Round 8** (Edda at Q11, facing SE, alarm curious 18)
  [model: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.] watch Q11 for 2 round(s) → watches Q11

_Forest (t9): A fox darts across the trail just ahead._
  - (curious): Lost sight of a doe, ears up (last seen at X6). | Heard a dry branch snapping, to the south-east, a short way off (around U18, give or take 5 ft). | Saw a red fox at T14.
  - (curious): Heard a dry branch snapping, to the south-east, a short way off (around U18, give or take 5 ft). | Saw a red fox at T14. | Heard a quick scrabble in the leaves, to the south-east, nearby (around U14, give or take 5 ft).

**Round 9** (Edda at Q15, facing SE, alarm curious 29)
  Edda moves Q11 → Q15 (30 ft, 0 ft left).
  [model: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.] investigate U18 → moved to Q15, heading for T17; still on the way
  - (curious): Saw a red fox at T14. | Heard a quick scrabble in the leaves, to the south-east, nearby (around U14, give or take 5 ft). | Lost sight of a red fox (last seen at T14).

_Forest (t10): The fox is gone into the undergrowth._

**Round 10** (Edda at T17, facing E, alarm routine 7)
  Edda moves Q15 → T17 (25 ft, 5 ft left). Lands on bracken [difficult, cover-half].
  [model: Find out what snapped the branch near U18 without showing myself, and note any poacher sign for the morning report.] investigate U18 → reached T17; found nothing

**Round 11** (Edda at O14, facing W, alarm routine 0)
  Edda moves T17 → O14 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to O14, heading for B9

_Forest (t12): A gust of wind rattles the canopy._
  - (routine): Lost sight of a red fox (last seen at T14). | Searched around U18 (Perception 16): found nothing. | Heard wind rushing through the canopy, leaves rattling all around, right here, very close (around O14).

**Round 12** (Edda at K9, facing NW, alarm routine 11)
  Edda moves O14 → K9 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to K9, heading for B9

**Round 13** (Edda at E10, facing W, alarm routine 4)
  Edda moves K9 → E10 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to E10, heading for B9

_Forest (t14): Down at the stream, a deer is drinking: a splash, and hooves on stones._

**Round 14** (Edda at B9, facing W, alarm routine 0)
  Edda moves E10 → B9 (15 ft, 15 ft left).
  [fallback: Walk the patrol route] walk your patrol route → reached B9

**Round 15** (Edda at H9, facing E, alarm routine 0)
  Edda moves B9 → H9 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to H9, heading for M10

_Forest (t16): The stag lifts its head and wades off downstream._

**Round 16** (Edda at M10, facing SE, alarm routine 0)
  Edda moves H9 → M10 (25 ft, 5 ft left).
  [fallback: Walk the patrol route] walk your patrol route → reached M10

**Round 17** (Edda at S11, facing E, alarm routine 0)
  Edda moves M10 → S11 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to S11, heading for X12

_Forest (t18): Very far away, a wolf howls. (Miles off; nothing to do with tonight.)_
  - (curious): Searched around U18 (Perception 16): found nothing. | Heard wind rushing through the canopy, leaves rattling all around, right here, very close (around O14). | Heard a wolf howling, very far off, to the north-west, some distance off (around D1, give or take 15 ft).

**[t17] Edda stops to think** (needs a model: Heard a wolf howling, very far off, to the north-west, some distance off (around D1, give or take 15 ft).)
  > **Haiku (as Edda):** “The sounds to the south-east are the only close unknown, and the snapped branch and scrabble both point that way. I turn to face them and watch before going closer, since a poacher or the doe could be there. The wolf is far off, so it does not change the plan much.”
  > belief (hypothesis, 0.45): The snapped branch and the scrabbling in the leaves came from the same creature moving through the brush south-east of me, between U14 and U18. It is probably the doe I lost sight of, but a person keeping low is possible.
  > belief (hypothesis, 0.5): The wolf howl far to the north-west is a real wolf, but it is well off and not an immediate threat to the patrol.
  > plan: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.: {"do":"guard","at":"S11","facing":"SE"} → {"do":"watch","at":"S11","rounds":2} → {"do":"investigate","at":"U14"} → {"do":"move","to":"X12"}
  > alarm: curious
  Edda's decision:
    accepted: belief b19; belief b20; alarm curious; intention i21: guard S11 facing SE; watch S11 for 2 round(s); investigate U14; move to X12

**Round 18** (Edda at S11, facing SE, alarm curious 25)
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] guard S11 facing SE → on guard at S11

**Round 19** (Edda at S11, facing SE, alarm curious 18)
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] watch S11 for 2 round(s) → watches S11

**Round 20** (Edda at S11, facing SE, alarm routine 11)
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] watch S11 for 2 round(s) → watches S11

**Round 21** (Edda at V14, facing E, alarm routine 0)
  Edda moves S11 → U14 (25 ft, 5 ft left).
  Edda moves U14 → V14 (5 ft, 0 ft left).
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] investigate U14 → reached U14; found nothing
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] move to X12 → moved to V14, heading for X12

_Forest (t22): Something small drops onto the leaves nearby. (An acorn.)_
  - (routine): Heard a wolf howling, very far off, to the north-west, some distance off (around D1, give or take 15 ft). | Searched around U14 (Perception 10): found nothing. | Heard something small thudding onto the leaves, to the south-east, very close (around X16).

**Round 22** (Edda at X12, facing NE, alarm curious 38)
  - (alert): Searched around U14 (Perception 10): found nothing. | Heard something small thudding onto the leaves, to the south-east, very close (around X16). | Saw an unidentified figure (?3) out of the corner of your eye at R18.
  Edda moves V14 → X12 (10 ft, 20 ft left).
  [model: Find out what is moving south-east of me near U14 and U18 without walking into an ambush, then finish the patrol route to X12 and note it for the morning report.] move to X12 → reached X12
  - (alert): Heard something small thudding onto the leaves, to the south-east, very close (around X16). | Saw an unidentified figure (?3) out of the corner of your eye at R18. | Saw a stag drinking at the stream in the gloom at R18.
  - (curious): Saw an unidentified figure (?3) out of the corner of your eye at R18. | Saw a stag drinking at the stream in the gloom at R18. | Lost sight of a stag drinking at the stream (last seen at R18).

**[t22] Edda stops to think** (needs a model: alarm rose to alert / Saw an unidentified figure (?3) out of the corner of your eye at R18.)
  > **Haiku (as Edda):** “The thud at X16 is very close and the figure at R18 appeared where the stag had been, so something other than the stag may be disturbing the stream. I will hold at X12 facing south, keep my back to the oaks, and check the thud before committing to a direction.”
  > belief (hypothesis, 0.4): The unidentified figure I glimpsed at R18 is a person, possibly a poacher working the stream, and not the stag itself.
  > belief (hypothesis, 0.45): The stag at R18 probably bolted when the figure appeared, since it vanished from sight right where the figure was seen.
  > belief (hypothesis, 0.35): The small thud on the leaves at X16 was made by something close to me to the south, either a small animal or a person moving quietly. I cannot tell which yet.
  > plan: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.: {"do":"guard","at":"X12","facing":"S","rounds":2} → {"do":"investigate","at":"X16"} → {"do":"watch","at":"R18","rounds":2}
  > alarm: alert
  Edda's decision (STALE: new evidence arrived while deciding):
    accepted: belief b27; belief b28; belief b29; alarm alert; intention i30: guard X12 facing S; investigate X16; watch R18 for 2 round(s)
    rejected: now: dropped, because something new happened while you were thinking (your plan and beliefs still stand)
  [minds] Edda (edda, alert): Saw a stag drinking at the stream in the gloom at R18. | Lost sight of a stag drinking at the stream (last seen at R18). | Saw a stag drinking at the stream in the gloom at R18.

**Round 23** (Edda at X12, facing S, alarm curious 38)
  [model: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.] guard X12 facing S → on guard at X12

**Round 24** (Edda at X12, facing S, alarm curious 31)
  [model: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.] guard X12 facing S → on guard at X12

**Round 25** (Edda at X16, facing SE, alarm routine 9)
  Edda moves X12 → X16 (20 ft, 10 ft left).
  [model: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.] investigate X16 → reached X16; found nothing
  [model: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.] watch R18 for 2 round(s) → watches R18
  - (curious): Saw a stag drinking at the stream in the gloom at R18. | Searched around X16 (Perception 21): found nothing. | Lost sight of a stag drinking at the stream (last seen at R18).

_Forest (t26): A nightjar churrs from the bracken._
  - (curious): Searched around X16 (Perception 21): found nothing. | Lost sight of a stag drinking at the stream (last seen at R18). | Heard a long, mechanical churring trill from the bracken, to the north-east, nearby (around Z12, give or take 5 ft).

**Round 26** (Edda at X16, facing W, alarm curious 20)
  [model: Find out whether the figure at R18 is a poacher and what made the thud at X16, without walking into an ambush, then finish the patrol to X12 and note it for the morning report.] watch R18 for 2 round(s) → watches R18

**Round 27** (Edda at X16, facing NE, alarm routine 13)
  [fallback: Check out a noise near Z12] watch Z12 for 1 round(s) → watches Z12

**Round 28** (Edda at X12, facing NE, alarm routine 6)
  Edda moves X16 → X12 (20 ft, 10 ft left).
  [fallback: Walk the patrol route] walk your patrol route → reached X12

**Round 29** (Edda at R11, facing W, alarm routine 0)
  Edda moves X12 → R11 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to R11, heading for B9

**Round 30** (Edda at L9, facing NW, alarm routine 0)
  Edda moves R11 → L9 (30 ft, 0 ft left).
  [fallback: Walk the patrol route] walk your patrol route → moved to L9, heading for B9

_(stopped at time 30)_
