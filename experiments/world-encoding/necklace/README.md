# The Necklace

Guy de Maupassant, 1884 (tr. Jonathan Sturges, 1898). About 2882 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

A single borrowed object: lent, lost, replaced, and paid for over ten years; at the end it is learned that the lost thing was nearly worthless. Most of the story is summary and a few scenes; time is stretched and cut (a ball in two paragraphs, ten years in six).
Stresses: summary narration and a ten-year jump, an object lost at an unknown moment and place, a false belief about the object's value held by the protagonists and the reader, a lie that buys time, a conditional agreement with a deadline, and money arithmetic.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text, paragraph by paragraph (paragraph `Pn` is the nth block separated by a blank line). |
| `v1/world/` | The story encoded in the project's current world formats (characters, places, things, lore, variables). Loads with the project's own loaders. |
| `v1/history.json` | What happens, as 20 records edits in story order, each with the clock the engine would read. Applies to a real story store. |
| `v2/story.json`, `v2/checks.json` | The story in the model described in `../MODEL-V2.md`, and what the check compares its derived values to. |
| `ledger.md`, `ledger.json` | Every part of the source, and how v1, draft and v2 hold it (E encoded, S stuffed into free text, N not representable, P projection). |
| `questions.json` | 13 questions about the story and whether each encoding can answer it from structure alone. |

## Results

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (66 units) | 23 | 33 | 8 | 2 |
| draft, evolved JSON | 51 | 12 | 2 | 1 |
| v2, derived model | 50 | 13 | 2 | 1 |

| Questions (13) | yes | partly | no |
|---|---|---|---|
| v1 | 1 | 7 | 5 |
| draft | 12 | 1 | 0 |
| v2 | 11 | 2 | 0 |

## What the encoding found

- v1: the necklace's loss has no moment or place; it has to be dropped somewhere and hidden
- v1: the replacement's buy-back deal has an expiry and a condition; an engagement has a time but no condition
- v1: the ten years are one event with a clock jump in the sidecar; the price of the final debt is not given anywhere
- v1: a character's belief cannot be marked false; Mathilde's belief that it was diamonds lives only as the accuracy of a perception
- v1: no way to say a deadline passed unused
- v1: no year; an invented year was chosen to fit a weekday
- v2: the clasp excuse is a claim derived false by the loss event; the paste is a state of the necklace
- v2: the daydream and the fear are held entries; the narrator's what-if is a reading, text only
- v2: 'least space, most time' is derivable from paragraphs per event against its duration
