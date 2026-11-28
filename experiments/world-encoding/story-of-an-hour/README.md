# The Story of an Hour

Kate Chopin, 1894. About 1017 words. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

A single room and about an hour. Most of the story is one woman's changing feeling, told by a narrator who can see inside her; the other characters never share that knowledge, and the one fact that ends the story is withheld until the last paragraphs.
Stresses: unknown absolute time, a false report that all but one character believes, interior states, imagined futures that never happen, an elided death, and a cause of death that is only implied.

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
| v1, current formats (59 units) | 13 | 36 | 6 | 4 |
| draft, evolved JSON | 42 | 14 | 0 | 3 |
| v2, derived model | 41 | 14 | 0 | 4 |

| Questions (12) | yes | partly | no |
|---|---|---|---|
| v1 | 3 | 7 | 2 |
| draft | 12 | 0 | 0 |
| v2 | 11 | 1 | 0 |

## What the encoding found

- v1: events have no time of their own, so the unknown date and the 'about an hour' were stuffed into clock notes and an invented starting_time
- v1: no way to say a report was false (the list); the truth went into a hidden lore entry and a 'negative' event
- v1: a character's false belief cannot be linked to its source or to the truth it contradicts
- v1: the anticipated futures (the funeral, the years of freedom) are stored as beliefs or events that look as if they happened
- v1: the death moment is elided in the text; nothing says an event is implied rather than stated
- v1: the doctors' cause of death is an accuracy label on a perception, which is the encoder's judgement, not canon
- v2: the false report is a claim; its verdict (false) is derived from the event of Brently walking in, not stored
- v2: the imagined futures are held entries; that they never happened is only an absence of a realising event, so the question about it is 'partly'
- v2: which events are told late is derived by comparing paragraph order with event order; nothing about telling is stored
