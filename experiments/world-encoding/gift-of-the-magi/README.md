# The Gift of the Magi

O. Henry, 1905. About 2064 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

Two strands that only meet at the end: Della's afternoon (on the page) and Jim's afternoon (offstage, told once, in his own words, in the last paragraph). Each gift defeats the other. A narrator who talks to the reader steps in and out of the story throughout.
Stresses: an offstage strand learned late, an elided haircut and payment, money accounting, placeholders for unnamed people and places, iterative habits, hypothetical frames and anticipated futures, an intrusive narrator.
The exact wording of dialogue is a telling choice. Both encodings keep what each speech says (v1 in what the listener took in, draft in `says`), not every word.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text, paragraph by paragraph (paragraph `Pn` is the nth block separated by a blank line). |
| `v1/world/` | The story encoded in the project's current world formats (characters, places, things, lore, variables). Loads with the project's own loaders. |
| `v1/history.json` | What happens, as 8 records edits in story order, each with the clock the engine would read. Applies to a real story store. |
| `v2/story.json`, `v2/checks.json` | The story in the model described in `../MODEL-V2.md`, and what the check compares its derived values to. |
| `ledger.md`, `ledger.json` | Every part of the source, and how v1, draft and v2 hold it (E encoded, S stuffed into free text, N not representable, P projection). |
| `questions.json` | 12 questions about the story and whether each encoding can answer it from structure alone. |

## Results

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (96 units) | 36 | 38 | 10 | 12 |
| draft, evolved JSON | 54 | 24 | 9 | 9 |
| v2, derived model | 51 | 25 | 9 | 11 |

| Questions (12) | yes | partly | no |
|---|---|---|---|
| v1 | 2 | 8 | 2 |
| draft | 11 | 1 | 0 |
| v2 | 10 | 2 | 0 |

## What the encoding found

- v1: Jim's offstage afternoon is chronological and simultaneous with Della's; v1 can only put it in a round of its own and cannot say it was learned only later from his own mouth
- v1: the haircut is elided in the text; v1 has to invent an event and an item change
- v1: placeholders had to be invented for the unnamed buyer, the unnamed shops and the unnamed place Jim went to, so that things can change hands
- v1: the year had to be invented; the price of the watch and of the combs is unknown and cannot be left unknown in a cash variable
- v1: pay history ($30 then $20) is a variable's current value only; the earlier value is lost
- v2: Della's wrong reading of Jim's stare is a claim, derived false by what Jim says next
- v2: the narrator's hypotheticals (Queen of Sheba, King Solomon) become readings, text only: the one place v2 holds less than draft
- v2: two of the 12 questions are 'partly' where draft said yes
