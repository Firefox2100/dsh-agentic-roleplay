# The Yellow Wall Paper

Charlotte Perkins Gilman, 1892. About 6089 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

A secret diary of eleven entries over a summer in a rented house. Everything we are told is one woman's account; what she sees in the wallpaper cannot be checked; the people who could contradict her (her husband and his sister) are shown only as she reads them.
Stresses: undated entries placed in a season by the narrator's remarks; an unreliable perceiver whose visions the text never labels as false; concealment as the story's engine; a husband whose care is also control; a key that is thrown to another place; an ambiguous name in the last lines.
Paragraph numbers follow the source file; whitespace-only paragraphs (the breaks between entries) are not rows.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text, paragraph by paragraph (paragraph `Pn` is the nth block separated by a blank line). |
| `v1/world/` | The story encoded in the project's current world formats (characters, places, things, lore, variables). Loads with the project's own loaders. |
| `v1/history.json` | What happens, as 12 records edits in story order, each with the clock the engine would read. Applies to a real story store. |
| `v2/story.json`, `v2/checks.json` | The story in the model described in `../MODEL-V2.md`, and what the check compares its derived values to. |
| `ledger.md`, `ledger.json` | Every part of the source, and how v1, draft and v2 hold it (E encoded, S stuffed into free text, N not representable, P projection). |
| `questions.json` | 13 questions about the story and whether each encoding can answer it from structure alone. |

## Results

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (64 units) | 18 | 36 | 8 | 2 |
| draft, evolved JSON | 49 | 9 | 5 | 1 |
| v2, derived model | 48 | 9 | 5 | 2 |

| Questions (13) | yes | partly | no |
|---|---|---|---|
| v1 | 1 | 6 | 6 |
| draft | 10 | 2 | 1 |
| v2 | 10 | 2 | 1 |

## What the encoding found

- v1: the woman behind the pattern is a perception marked 'mistaken'; that is stronger than the text, which never says she is not there
- v1: eleven undated entries have no place in the summer except by the narrator's own remarks, which are text; the clock sidecar had to invent dates
- v1: concealment (hiding the diary, the wakefulness, the woman) is the story's engine and is only text; there is no 'conceals from' relation
- v1: the key was thrown into the front path; no item action throws a thing to another place
- v1: the narrator's identification with the woman ('as I did') and the ambiguous 'Jane' have no place
- v1: a diary is both what is told and the narrator's one private act; v1 holds it as an item
- v2: dropping the telling track exposed seven paragraphs draft had never encoded (the garden, her musings, a transition); they became states, claim sources, or are marked exempt
- v2: the diary entries are events of writing, with their own times, rather than a telling device
- v2: the woman in the wallpaper is an unresolved claim: no event bears on it, so nothing says she is not there
