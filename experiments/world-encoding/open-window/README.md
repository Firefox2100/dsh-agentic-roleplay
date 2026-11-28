# The Open Window

Saki, 1914. About 1212 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

A visitor is told a ghost story by a teenager; the ghosts walk in at tea-time; a second invention covers the first. Nothing in the narration says the story is a lie until the last sentence.
Stresses: a told fiction (a story inside the story) whose parts are partly true and partly invented, a false belief that reads true evidence as proof, a deceiver whose lie is only labelled at the very end, a performance (acted horror) that looks like feeling, and a viewpoint that stays behind when the visitor leaves.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text, paragraph by paragraph (paragraph `Pn` is the nth block separated by a blank line). |
| `v1/world/` | The story encoded in the project's current world formats (characters, places, things, lore, variables). Loads with the project's own loaders. |
| `v1/history.json` | What happens, as 4 records edits in story order, each with the clock the engine would read. Applies to a real story store. |
| `v2/story.json`, `v2/checks.json` | The story in the model described in `../MODEL-V2.md`, and what the check compares its derived values to. |
| `ledger.md`, `ledger.json` | Every part of the source, and how v1, draft and v2 hold it (E encoded, S stuffed into free text, N not representable, P projection). |
| `questions.json` | 12 questions about the story and whether each encoding can answer it from structure alone. |

## Results

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (59 units) | 17 | 23 | 17 | 2 |
| draft, evolved JSON | 36 | 18 | 5 | 0 |
| v2, derived model | 35 | 18 | 5 | 1 |

| Questions (12) | yes | partly | no |
|---|---|---|---|
| v1 | 1 | 4 | 7 |
| draft | 11 | 1 | 0 |
| v2 | 10 | 1 | 1 |

## What the encoding found

- v1: Vera's tale can only be an event whose perception is marked mistaken; none of its parts (which are true, which false) can be held
- v1: the true details inside the false tale (window open, white coat, spaniel, the song) cannot be separated from the false core
- v1: Framton's misreading of Mrs. Sappleton's true words as proof of the tale's truth has no home except a perception's accuracy
- v1: no animal kind (a spaniel is a 'person'); several placeholders for unnamed people and places
- v1: the year and the day had to be invented
- v2: the invented tale is the speech of one event; its parts are claims whose verdicts are derived from later events, so no frame is needed
- v2: the coat claim derives true (draft said contradicted): the detail is real, and the misreading is Framton's inference. draft had mixed truth with inference
- v2: the narrator's viewpoint after Framton leaves is voice, and is not stored (no)
