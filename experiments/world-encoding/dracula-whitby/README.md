# Dracula, Chapter VII: the Whitby storm and the log of the Demeter

Bram Stoker, 1897. Public domain. About 5,700 words, 67 paragraph blocks. The text is from Project Gutenberg ebook 345 (see `source/SOURCE.md`).

A derelict schooner comes into Whitby harbour in a storm with a dead man tied to the wheel; a huge dog leaps ashore; the log is read at the inquest; a girl sleep-walks through the same night. Stresses: simultaneous action in several places in one night (the crowd, the searchlight, the coastguard, Mina's rooms), a voyage told only through a log read days later, nested telling (the log, the correspondent's dispatch, Mina's journal), a crew that thins out under a presence nobody can confirm, and dates that conflict inside the text.

Encoded only in v2, directly, as the third fresh work. It was chosen to test simultaneity, which neither earlier work could (the Speckled Band had a clock for one place, Much Ado for none). It was also read against what roleplay needs; the questions carry a `play` rating.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The chapter; `Pn` is the nth block. |
| `v2/story.json` | 57 events (33 played, 23 backfilled from the log, 1 offscreen), 13 claims, 11 states, 7 held items, 24 knowledge rows, 5 readings, 2 question sets. |
| `v2/checks.json` | The answer key (blind, written before the encoding), with its corrections listed. |
| `ledger.md`, `ledger.json` | 53 units, clusters of paragraphs. |
| `questions.json` | 19 questions, each rated for whether v2 answers it and whether play needs it. |

## Results

| v2 (53 units) | E | S | N | P |
|---|---|---|---|---|
| | 48 | 2 | 0 | 3 |

| Questions (19) | yes | partly | no |
|---|---|---|---|
| v2 | 12 | 6 | 1 |

| By what play needs | needed in play | helpful | analysis only |
|---|---|---|---|
| Questions | 8 (7 yes, 1 partly) | 8 (4 yes, 3 partly, 1 no) | 3 (1 yes, 2 partly) |

Read with care, as before: clusters, one encoder, E generous, no comparison with the first six works.

## What was tried and what happened

| Change | Result |
|---|---|
| **Blind key** | Written before any record (file time before `story.json`). Everything held except two entries, both mine (see `key_corrections`): I forgot that Mina's night is told after the 9 August dispatch though it happened before it; and I read four verdicts as the captain's view in the voyage when the validator reads the record. The second was a gap in the model, not a mistake in the key. |
| **Simultaneity from the clock** | Worked, in three values: `definite` (both events dated and overlapping), `possible` (an undated event that is only 'within' a dated interval) and `none`. The storm breaking and the beaching do not overlap; the searchlight and the beaching do; Lucy's two walks are possibly simultaneous with the beaching. Five pairs checked. |
| **Four time bases** | Needed. Overlap is only derived inside one base (the log's dates, the storm night, 9 August, 10 August). The bases cannot be tied: the text's own dates conflict, so the model holds the conflict (two open claims, each undermined by the other's evidence) instead of picking one. |
| **Two clocks for a verdict** | New. `verdict_at` is the record's view; every voyage event enters the record at once, when the log is read. A character judges from what they knew then. Added `verdict_for(person, moment)`: the claim's bearings the person knows at that moment (party to the event, or told). The captain thinks the stranger unlikely right after the search, open after the mate's account, and believes the mate killed the crew until he sees It himself. |
| **Rival claims** | Three rival explanations of the crew's deaths all derive open or unresolved; the rule correctly leaves them alone because none is `true` or `likely`. |
| **Who knows what at a moment** | `knows_at` works for a character who learns by reading a document later (Mina and the cutting) and for the correspondent's chain (the captain's log, read through a clerk). |
| **A sleeper** | The party rule said Lucy knows her own sleep-walk. An `unaware` row (how: asleep) now overrides it, the same override Much Ado removed for ordinary absence. Added after the encoding, so not blind. |
| **Held items, derived outcomes** | Four `fulfilled` (the captain's tying, the funeral, the promised dispatch, the mate's going down to open the boxes), one `prevented` (finding the dog), two `open` (Mina's walk, Jonathan's news). |
| **Telling order** | Derived `told_late`: Mina's night and her morning at the harbour. |

## Roleplay lens

What a game master, a character agent or the keeper reads, against what only an analyst reads:

| Finding | In play |
|---|---|
| A character's own judgement of a claim, from what they knew then | **Needed.** A character agent must not use what the record knows but they do not. `verdict_for` is the first derived thing here that the character prompt could take. |
| Possible overlap: Lucy's alibi against the beaching | **Needed.** Who could have seen what, who could have been where: the three answers are what a game master needs to keep a scene fair. |
| Open claims and unresolved hooks (the stranger, the dog's whereabouts, Jonathan, the walk) | **Needed.** They are what the game master must not resolve early, and what triggers can wait on. |
| A character who is a party to an event but unaware of it (a sleeper) | **Needed.** Sleep is already in the product (the sleep and wake mechanics); the experiment says the party rule must yield to it. |
| A conflict inside a source (which night) | **Helpful.** A world import should flag it; a check, not a story field. |
| A group as one entity (the crowd) | **Needed to decide.** A scene with a crowd needs someone in it to see the dog; a group row cannot answer that. |
| Telling order, layers of provenance, readings of the narrator | Analysis only. |

## What else it found

- **The voyage is one record entry.** The 23 backfilled events all enter the record when the log is read. For play this is the more important fact: the player's character may read the log at the inquest, but the crew lived through it event by event.
- **A thing nobody can confirm.** The stranger has no being: seen three times, never found, the knife goes through. The model holds a person-kind entity and an open claim. Whether the game master may bring It into a scene is not a question of the model.
- **Implied causes stay implied.** The mastiff's death, Mr Swales's death and the dog are linked only by the reader; no `causes`.
- **Nothing was cut.** The ledger has no N rows, which says the clusters are generous, not that nothing was lost (notes list the strains: the stranger, the round robin, the salvage law).

## Caveats

- The blind key was written after I had decided which events and claims there would be. It is independent of the links, not of my reading.
- `verdict_for` and the sleeper override were built after the first run, from what the check showed, and their checks are not blind.
- One encoder, who also designed the model.
- Times are mine: the beaching and the storm are given in minutes from a Saturday midnight, from 'a little after midnight', 'shortly before ten' and the order of the text; no clock in the chapter gives more.
