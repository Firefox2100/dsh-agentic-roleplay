# Much Ado About Nothing, Act 2 scene 2 to Act 3 scene 2

William Shakespeare, about 1598. Public domain. About 4,600 words, 215 blocks (one per speech or stage direction); the text is from MIT's Complete Works (see `source/SOURCE.md`).

A villain plots to break a marriage (Act 2 scene 2). Two staged overhearing scenes make two enemies lovers by false report (Act 2 scene 3, Act 3 scene 1). The excerpt ends with the lie that will break the marriage (Act 3 scene 2). Stresses: a crowd whose members know different things at each moment, concealment among several people at once, false claims told on purpose, rival motives, no narrator, and no clock.

Encoded only in v2, directly, as the second fresh work after the Speckled Band. It was chosen because the Speckled Band had only two rooms in play and no ensemble.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The excerpt; `Pn` is the nth block. |
| `v2/story.json` | The encoding: 56 events (51 played, 3 backfilled, 2 offscreen), 14 claims, 8 states, 10 held, 35 knowledge rows, 4 readings, 1 question set. |
| `v2/checks.json` | The answer key and what the validator holds the story to. Written before the links (see below). |
| `ledger.md`, `ledger.json` | 69 units, clusters of speeches. |
| `questions.json` | 19 questions and whether v2 answers each from structure. |

## Results

| v2 (69 units) | E | S | N | P |
|---|---|---|---|---|
| | 63 | 5 | 0 | 1 |

| Questions (19) | yes | partly | no |
|---|---|---|---|
| v2 | 13 | 5 | 1 |

Read with care. The units are clusters of speeches, so a row with a figure of speech in it is classed E when the content is encoded, and the E count is generous (the notes column lists what stayed in the voice). There is no v1 or draft, one encoder, and the totals do not compare with the first six works.

## What was tried and what happened

| Change | Result |
|---|---|
| **Answer key before the links (blind check)** | Written first (see `checks.json`, with its file time before `story.json` existed). Two entries were wrong and are corrected in `key_corrections`: I had missed that Claudio's "stalk on, the fowl sits" (P58) comes one block before Leonato's claim, so the claim is already `unlikely` when it is made; and I had assumed a hidden listener hears an aside. The model found both. Three more mismatches were my encoding (a missing `fulfils`, a line of Don Pedro's not marked as an aside, a scene heading in no record) and two were the model: it had no default order within a scene. |
| **Rival claims** | Worked where it had the most to do. `c-john-zeal` (Don John acts out of regard for Claudio) has no bearings of its own; it derives `false` only because its rival `c-john-spite` derives `true` from Don John's own words to Borachio. In the Speckled Band the same rule changed one verdict; here it decided one outright. |
| **A keeper reading both ways** | Of 25 links, 15 are evidence recorded before the claim (60%; the Speckled Band had a third). The schemers state their plan first and the accusation follows, so looking back is not optional. |
| **Strong evidence** | 10 of 25 links are strong (nine `contradicts`, one `confirms`) against about a fifth in the Speckled Band. In a staged story the strongest evidence is the stager's own plan, spoken before the lie: Borachio's plan makes Hero's disloyalty `false`; Don Pedro's "no such matter" line makes four claims `false`. |
| **Concealment among several people** | Needed one change: `from` takes a list. Four `conceal` events plus one aside-taking walk (Benedick hides from four, feigns a toothache from three, Don John feigns zeal to two, the plot is hidden from four) hold who hides from whom. Whether it worked is in knowledge rows (`unaware`, `believes`), not in the event. |
| **Who heard what** | Not derivable from presence. A hidden listener hears everything said in front of him unless the line is an aside, and nothing in the text says so; `audience` on the event is the encoder's reading from what Benedick does next (P108). With it, hearing is derived from the parties plus the concealment state covering the event's moment. |
| **Order with no clock** | Derived from relations plus one default: events in a `scene` are ordered by their text order, and across scenes only the stated relations count. So the garden scene and the men's teasing are `unordered`, though the text prints one after the other. |
| **Simultaneity** | **Not tested.** There is no clock in a play, so there are no `when.t` values. This was the main reason for choosing the work, and the work could not supply it. |
| **Held items, no closed-world rule** | Of ten: two `fulfilled` (the net for Beatrice; Don John "learns" what he already knew), two `waiting` (Claudio's vow and the fee, which take an `if` on another held item that is itself open), six `open` (the window, the serenade, the wedding, Benedick's speech and wooing, the proof). |
| **Dramatic irony** | Held by the reader's own knowledge rows by paragraph (`para:P16` onward knows the plot; Benedick `unaware`). A reading, `r-john-irony`, says the same line is sympathy to some hearers and triumph to others, and the text never says which. |
| **False beliefs at a moment** | Derived: a person's `believes` row active at a moment, against the claim's verdict at that moment. Benedick believes a `false` claim when he comes out of the arbour; Claudio, who only doubts, does not. |

## Second round: what was done about the findings

The first pass left eight problems. Each was either built and checked, or left with a reason.

| Finding | What was done |
|---|---|
| Conditions have no home | Built: a held item takes `if` (other held items). Outcome is derived: `fulfilled`, `prevented`, `void` (a condition was prevented), `waiting` (a condition is not yet fulfilled) or `open`. The vow waits on the proof being shown; the fee waits on the staged window. Not built: a deadline ("till midnight") and a number (a thousand ducats), which need a clock and a value. |
| A lie told on purpose | Built as a check, not a field: a claim is told in bad faith if its asserter, when asserting, was a party to an event, or holds a `knows` row, that contradicts it (or confirms its rival). Needed a backfilled event (`b-gull-planned`) so Leonato's knowledge precedes his claim. An overhearer who misreads (Benedick's "this can be no trick") has the evidence and is not lying; so presence counts only for parties. |
| A claim's absent source | Built as a check: `cites` on the claim; the check derives that the cited person (Hero) never speaks before the claim. It says that nothing records Hero saying it, not that she did not. |
| A feeling caused by a false claim | Built as a check: `causes` between events already existed; the check follows them from Benedick's changed looks back to Leonato's claim and reports that they rest on a claim that derives untrue. |
| Who hears an aside | Replaced the free-text `manner: aside` with `audience` (a list); hearing is derived from it. Still the encoder's inference; the text does not say. |
| `unaware` rows | Built: not knowing is derived. A person who was not a party to an event, not within hearing and not told it does not know it. Eleven of 43 rows became unnecessary and were removed. A person who learns from a source still needs a row. |
| Compound claims | Built for the Speckled Band (`parts`, each with its bearings; the whole derives `mixed` when parts differ). Not needed here: the letter story is five details, all untrue together. An error of mine in the first pass: Claudio's "Hero and Margaret have played their parts" is not half wrong; Margaret was the courier. It was a true claim that is not exhaustive (Ursula also played a part). |
| A play has no clock | Not fixed; needs a different work (tested on Dracula, Chapter VII). |

The checks added in this round were written after I knew the encoding, so they are not blind (see `post_hoc` in `checks.json`).

## Caveats

- The key was written before the links, but after I had read the text and decided the events and claims. It is not independent of my reading, only of the links. The two errors it caught in my first guess came from reading too fast, not from the model.
- Two of the model's changes were found by the first check (the scene order default, the list in `from`); both were needed to make the excerpt expressible, not to match the key. The second-round checks are not blind.
- One encoder, who also designed the model. One excerpt of one play; the transcription's asides and one speaker are my corrections.
- Hearing and `audience` are the encoder's inference. A different reader might mark P58 or P106 differently and `heard_by`, `knows_at` and `lies` would change with it.
