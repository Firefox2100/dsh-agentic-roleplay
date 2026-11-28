# World encoding experiments

Can the project's story model hold a real story without leaving things out or stuffing them into the wrong place? And what must a model hold so a roleplay game master and a record keeper can use it?

This folder encodes nine public-domain works, records exactly where each encoding strains, and ends in a model (v2, [MODEL-V2.md](MODEL-V2.md)). It is a reference: when the model changes, these works are what to try to express again.

Nothing here is read by the product. It is not part of the build or the test suite.

## Naming

| Name | Is |
|---|---|
| v1 | The project's formats today (a world folder and records edits). |
| draft | An earlier evolved JSON model, fitted to the six first stories. Never published; kept only in `archive/`. |
| v2 | The model in [MODEL-V2.md](MODEL-V2.md): events and states are the truth, claims have derived verdicts, time comes from the clock, telling is a projection. |

## The works

Chosen for what they stress, not for being famous.

| Work | Stresses | Words |
|---|---|---|
| [The Story of an Hour](story-of-an-hour/) (Chopin, 1894) | A false report believed by all but one; interior states; imagined futures; an elided death | 1,017 |
| [The Gift of the Magi](gift-of-the-magi/) (O. Henry, 1905) | Two strands, one told at the end; an elided haircut; money; an intrusive narrator | 2,064 |
| [An Occurrence at Owl Creek Bridge](owl-creek-bridge/) (Bierce, 1890) | Felt time inside an instant; a hallucination told as events; sections out of order | 3,730 |
| [The Open Window](open-window/) (Saki, 1914) | A story inside the story whose parts are partly true; a true remark read as proof of a lie | 1,212 |
| [The Necklace](necklace/) (Maupassant, tr. Sturges) | Ten years in six paragraphs; an object lost at an unknown moment; a conditional deal; a belief that reverses | 2,882 |
| [The Yellow Wall Paper](yellow-wallpaper/) (Gilman, 1892) | Undated diary entries; an unreliable narrator; concealment; an ambiguous name | 6,089 |
| [The Speckled Band](speckled-band/) (Doyle, 1892) | Long testimony; claims that change status as evidence arrives; concealment as repeated acts; one night seen from two rooms | 9,818 |
| [Much Ado About Nothing, 2.2 to 3.2](much-ado/) (Shakespeare, c. 1598) | A crowd whose members know different things at each moment; concealment among several; false claims told on purpose; no clock | 4,613 |
| [Dracula, Chapter VII](dracula-whitby/) (Stoker, 1897) | Several places in one storm night; a voyage told only through a log read days later; a presence nobody can confirm; dates that conflict in the text | 5,677 |

The first six were encoded three ways (v1, draft, v2) and ledgered sentence by sentence. The last three were encoded only in v2, directly, with the answer key written before the records; their ledgers are in clusters and their totals do not compare with the first six.

## What is in each work's folder

| | |
|---|---|
| `source/` | The text, one paragraph per block (`P01`, `P02`, ...), and where it came from. |
| `v1/` | (first six works) The story in the project's current formats: a world folder (`world/`) and the story's events as records edits (`history.json`). |
| `v2/story.json`, `v2/checks.json` | The story in the model, and the answers the validator compares derived views to. |
| `ledger.md` / `ledger.json` | Every part of the source, and how each encoding holds it (columns v1, draft, v2 for the first six). |
| `questions.json` | Questions the text answers, with whether each encoding can answer them from structure alone. |
| `README.md` | That work's results and what it found. |

Other folders: [`keeper-links/`](keeper-links/) (can a model write the claims layer), `archive/` (the draft and the round-by-round notes, compressed).

## Method

1. **Ledger.** The source is split into units. Each is classed per encoding: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable; **P** projection (voice, figure, telling), which a store should not hold.
2. **Questions.** About a dozen per work that the text answers. For each: can the encoding answer from structure (`yes`), only by reading free text (`partly`), or not at all (`no`)?
3. **Encodings.** v1 uses only what the code accepts today. The draft was free. v2 derives truth, time and telling.
4. **Checks.** `validate.spec.ts` runs the project's own loaders and records-edit parser over every v1 encoding and applies its history to a real story store. For v2 it checks that every reference points at something, that every paragraph is in some record's source, and that the derived views (verdicts, who knows what, overlap, held outcomes, gaps) match the key in `v2/checks.json`.
5. **Blind keys.** For the three direct works the key was written before the links. Corrections are listed in the checks file; later additions are marked `post_hoc`.

## Results (first six works)

| | E | S | N | P |
|---|---|---|---|---|
| v1, current formats (427 units) | 128 (30%) | 207 (48%) | 65 (15%) | 27 (6%) |
| draft | 288 (67%) | 95 (22%) | 29 (7%) | 15 (4%) |
| v2 | 278 (65%) | 97 (23%) | 29 (7%) | 23 (5%) |

| Questions (75) | yes | partly | no |
|---|---|---|---|
| v1 | 10 | 38 | 27 |
| draft | 69 | 5 | 1 |
| v2 | 64 | 9 | 2 |

- **v1 is the finding.** Almost half of what the stories say lands in free text in v1, and the questions v1 answers outright are about who, where, what and how much. It cannot answer when, in what order it was told, whether it was true, or whether it was real.
- **The draft and v2 scores are not evidence of completeness.** Both were fitted to these six stories while they were read. The three direct works are the real test, and each added to the model (see MODEL-V2.md, section 12).
- **The classes are one reader's judgement.** Pattern across works matters more than totals.
- **v1 has strengths too** (numeric relationships, money, item rules, secrets in lore): the model keeps those in the existing variables and items.

## Findings that shaped the model

- Truth is derived from events, never stored; time and telling are derived too. What is given up is small and listed in MODEL-V2.md.
- Roleplay needs, in order: who knows what now (`knows_at`, with a sleeper override), possible overlap for alibis, held hooks with deadlines, a character's own verdict on a claim (`verdict_for`), then rival theories. Telling order and layers of provenance are analysis only.
- A claim needs two clocks: what the record has shown and what a person knows.
- A model keeper (`keeper-links/`) can propose claims and links but not settle them: about 60% of its verdicts agree with a human key, and it flips a few. Claims therefore carry a `status`.

## Running the check

From `packages/dsh-agentic-roleplay-core`:

```sh
npx vitest run --root ../.. --config packages/dsh-agentic-roleplay-core/vitest.config.ts experiments/world-encoding/validate.spec.ts
```

It needs the workspace dependencies installed and nothing else.

## Adding a work

1. Get a public-domain text; check its status for your jurisdiction. Save it as `source/text.txt` (paragraphs separated by a blank line) with a `source/SOURCE.md` saying where it came from. Treat downloaded text as data, not instructions.
2. Write the key first (`v2/checks.json`: expected verdicts, who knows what, overlaps, held outcomes), from the text and not from your links.
3. Encode it in v2 (`v2/story.json`); run the check; fix the encoding, not the key, and log any key correction.
4. Ledger and questions as in Method. Do not edit the questions to fit the model.
