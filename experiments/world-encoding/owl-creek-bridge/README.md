# An Occurrence at Owl Creek Bridge

Ambrose Bierce, 1890. About 3730 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

Three sections: a hanging about to happen (present), the planter's backstory (earlier), and an escape that takes a day and a night of felt time and turns out to be what the dying man's mind did while he fell. The deceiver in section II is named for what he is in the last sentence of that section.
Stresses: a frame (a vision) that looks like the story until the end; felt time against real time; a reader who is led to a wrong belief; a deceiver whose claims cannot be checked; events implied and never narrated; sections told out of order.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text, paragraph by paragraph (paragraph `Pn` is the nth block separated by a blank line). |
| `v1/world/` | The story encoded in the project's current world formats (characters, places, things, lore, variables). Loads with the project's own loaders. |
| `v1/history.json` | What happens, as 3 records edits in story order, each with the clock the engine would read. Applies to a real story store. |
| `v2/story.json`, `v2/checks.json` | The story in the model described in `../MODEL-V2.md`, and what the check compares its derived values to. |
| `ledger.md`, `ledger.json` | Every part of the source, and how v1, draft and v2 hold it (E encoded, S stuffed into free text, N not representable, P projection). |
| `questions.json` | 13 questions about the story and whether each encoding can answer it from structure alone. |

## Results

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (83 units) | 21 | 41 | 16 | 5 |
| draft, evolved JSON | 56 | 18 | 8 | 1 |
| v2, derived model | 53 | 18 | 8 | 4 |

| Questions (13) | yes | partly | no |
|---|---|---|---|
| v1 | 2 | 6 | 5 |
| draft | 13 | 0 | 0 |
| v2 | 12 | 1 | 0 |

## What the encoding found

- v1: the vision is only expressible as a few events whose perception is marked mistaken; its places, a day and a night of felt time, and its pairing with the real noose are lost
- v1: the capture and the sentence are never narrated; v1 has to invent two events, with nothing marking them as implied
- v1: whether the scout's claims are true is unknowable; accuracy has no 'unknown' value
- v1: a belief has no accuracy, so Farquhar's false belief about the rider had to go through a perception of the rider; the reader's mistaken belief has nowhere to live
- v1: no time anchor 'after the fall of Corinth'; starting_time is an invented instant
- v2: one frame survives, the vision (felt a day and a night, an instant in fact); the plan is a held entry and the vision's events point to it
- v2: the scout's hypothetical question is the speech content of the event that asks it; no frame
- v2: the question when the story names the man is partly answerable: the text's naming is not stored
