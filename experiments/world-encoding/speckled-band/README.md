# The Adventure of the Speckled Band

Arthur Conan Doyle, 1892. About 9,800 words, 251 paragraph blocks. Public domain in the United States; the text in `source/` is from Wikisource (see `source/SOURCE.md`).

A woman brings Holmes the unexplained death of her twin. The first theory (gypsies) is wrong; the true method is reconstructed from clues on site and shown in the last scene. Stresses: testimony as most of the first third (backstory told by one person, doubted by her), claims that change status as evidence arrives, a reconstruction nobody witnesses, concealment as a repeated act, a night watched from two rooms at once, and a narrator who writes years later.

This is the first work encoded **only in v2**, directly, and the first test of the changes agreed after the six-work pass. It has no v1 and no draft, so nothing here is compared with them.

## Files

| File | What it is |
|---|---|
| `source/text.txt` | The story text; paragraph `Pn` is the nth block separated by a blank line. Two blocks (P01, P195) hold two narrative paragraphs each. |
| `v2/story.json` | The encoding: 107 events, 24 claims, 38 states, 7 held, 43 knowledge rows, 12 readings. |
| `v2/checks.json` | What the validator holds it to: derived verdicts, verdicts at named moments, held outcomes, overlapping and non-overlapping events, events told late. |
| `ledger.md`, `ledger.json` | 106 units (clusters of sentences or whole exchanges, not single sentences) and how v2 holds each. |
| `questions.json` | 19 questions and whether v2 can answer each from structure alone. |

## Results

| v2 (106 units) | E | S | N | P |
|---|---|---|---|---|
| | 83 | 17 | 5 | 1 |

| Questions (19) | yes | partly | no |
|---|---|---|---|
| v2 | 14 | 3 | 2 |

These do not compare with the six earlier works: the units are larger, the ledger and questions were written by the person who wrote the encoding and the model, and there is no second encoder. Read the findings, not the totals.

## The changes under test, and what happened

| Change | Result |
|---|---|
| **A keeper-style pass writes `bears_on`**, against claims, as events are recorded | Worked, with two corrections. 41 links, 14 of them evidence recorded *before* the claim was made (a third), so a keeper must look both ways: new events against open claims, new claims against recorded events. And only 9 of the 24 claims have a strong bearing (confirms, contradicts); see the next row. |
| **Drop `disputes`** | Never missed. No claim here is both confirmed and contradicted. |
| **Add weak bearings** (not planned) | Needed. `supports` and `undermines` carry 32 of the 41 links; without them 15 of 24 claims stay unresolved, including the central one (how Julia died), which the story only ever reconstructs. Verdicts became `true`, `false`, `likely`, `unlikely`, `open`, `unresolved`. |
| **`origin` only, no `basis`** | `basis` was not missed. 30 events are `backfilled` (Helen's testimony), 7 `offscreen`. What was missing is *when* a past event enters the record: a backfilled event bears on claims from the scene that established it, not from when it happened, so `established_in` was added. With it, "what rests on Helen's word alone" is answerable. |
| **Concealment with no new structure** | Held as three events of kind `conceal` with a `from` person and `unaware` knowledge rows. It answers "who was hiding what from whom". It cannot answer whether it worked (Roylott never shows he was fooled), which is also what the text does not say. |
| **Simultaneity derived from the clock** | Worked where there is a clock: `when.t` on the one day gave five overlaps and two non-overlaps, and caught an encoding mistake of mine (I had the vigil ending before the snake was sent). The night of Julia's death and the years before have order only. |
| **No closed-world rule for held items** | Right. Helen's wedding is `open`: the story ends first and she dies later, so "did not happen" would be wrong. Held items derive `fulfilled`, `prevented` or `open` from events that name them. |

## What else it found

- **Telling order is derivable, with a convention.** Taking the first paragraph of `src` as where an event is told, three events are told after later ones: Holmes deduces the ventilator (made at Baker Street, told at the inn), drops the gypsy theory, and suspects the snake (both made on the lawn and told on the train home). Mentions inside a paragraph range gave false positives until events were split at paragraph boundaries. `src` cannot say "mentioned here, disclosed there" (the clamped bed is seen at P147 and shown to the reader at P214); a reader's knowledge row carries that.
- **Rival explanations needed a link, and the link changed little.** The clang, Julia's death and the band are each a `questions` entry listing exclusive claims; a rival that derives `true` contradicts the others, one that derives `likely` undermines them. It changed one verdict (death from fear, `unresolved` to `unlikely` once the snake is suspected). See MODEL-V3.md, "Rival claims".
- **A doubt voiced by the claimant is a stance, not a bearing.** Helen is unsure she heard the whistle. Encoding it as `undermines` turned a `likely` claim into `open`. It belongs in knowledge (`doubts`).
- **The solution is a claim.** Everything Holmes explains at the end is his reconstruction; the narrator says "such are the true facts" only of Roylott's death, which already derives `true`. So the answer to the story's question derives `likely`, as the text leaves it. An earlier version of this note called that a gap; it is not: a narrator who vouches would be an event of kind `narration` that `confirms` (MODEL-V3.md, Proposals).
- **A compound claim needed `parts`.** "Died while indiscreetly playing with a dangerous pet" is right that the pet killed him and wrong that it was play (Holmes reconstructs a deliberate sending). With `parts`, each with its own bearings, the claim derives `mixed`. Built after the first pass.
- **A claim's subject can be an inference of the encoder.** Helen's "he" in P19 is never named; I took it as Armitage from P66. A claim cannot say so.
- **Obligations with a condition and a date**: the condition now has a home (`if` on a held item, built in the second pass on Much Ado); the date and the amount (the promise to pay after the wedding) are still text.

## Caveats

- The answer key in `v2/checks.json` was written after I had written the `bears_on` links, not blind. The check shows internal consistency and the time-indexed behaviour (a negative control with edited links fails it); it does not show the links are the right ones.
- One encoder, who also designed the model.
- The ledger's E count rewards cluster rows. A cluster that is half encoded and half text is classed E unless I noted the strain; there are 17 S rows and the notes column lists the strains.
- No v1 or draft for this work, so no regression test against them.
