# Keeper-links experiment

Can a model write the claims layer of the story model (claims, their `bears_on` links, rival sets) that the Speckled Band encoding got from its author? Until this experiment every link rested on one reader's judgement. Blind model keepers wrote them from the events and the text, and the verdicts derived from their links were compared with the answer key (`../speckled-band/v2/checks.json`, `expected_verdicts`).

**Result in one line:** a model can propose claims and links that are right on about 60% of verdicts and safe on another 30%, but it flips a few, finds only a third of the claims that matter and none of the rival theories. So its output is a proposal that someone confirms; it is not settled truth (`status: proposed` in MODEL-V2.md).

## Layout

| | |
|---|---|
| `input/` | What a keeper is given: `brief.md` (rules, no answers), `events-K.json` and `source-K.txt` (the story known by slice K = 1..4, cumulative), `claims-K.json` (the claims asserted by then: id, text, by, asserted_in), `people.json`. My links and verdicts are not in it. |
| `runs/<name>/claims.json` | Each run's final output; `mapping.json` beside it maps the run's own claim ids onto mine where it wrote its own claims. |
| `judge/` | The links sampled for the blind judge (`judge-sample.json`) and its ratings (`judge-verdicts.json`). |
| `score.py` | Derives verdicts from a run's links with the validator's rules and compares with the key; flags below reproduce every variant in this document. |
| `tools/` | `keeper35.py` (the incremental keeper on the product's model through LocalAI), `signcheck35.py` (second pass on each link's sign), `claims35.py` (per-scene claim detection). |

```sh
python3 score.py runs/35b-signrule-1/claims.json --cap-rivals 4
python3 score.py runs/sub-claims-and-links/claims.json --map runs/sub-claims-and-links/mapping.json
```

Flags: `--map`, `--cap-rivals N`, `--no-rivals`, `--cap-assertions`, `--drop-assertions`, `--two`.

## Runs

Two keepers: Claude subagents (`sub-*`), and the product's own model, Qwen 3.6 35B through LocalAI with thinking off and JSON-schema output (`35b-*`). One model per run, no run is a repeat of another unless numbered.

| Run | Keeper sees | Claims | Writes |
|---|---|---|---|
| `sub-links-only` | the whole story | given (24) | links, rival sets |
| `sub-claims-and-links` | the whole story | none | claims, links, rival sets |
| `sub-incremental-1..3` | four slices in turn, its own earlier links | given | links, rival sets |
| `35b-plain-1..3` | same four slices | given | links, rival sets |
| `35b-signrule-1..3` | same, with a sign rule in the brief | given | links, rival sets |
| `35b-detect-1..2` | same, claims found per slice first | its own | links, rival sets |

The sign rule: `as` is always about the claim as worded; an event that replaces or rules out the claim contradicts it; an event where someone only says or argues something supports or undermines.

## Results (24 claims, final state, against the key)

A *flip* is a verdict on the opposite side of the key's (true/likely against false/unlikely). *Strength* is true against likely, false against unlikely. *Settled vs open* is a verdict the key settles that the keeper leaves open, or the reverse. The last two are safe for play: the game master reads them as not settled.

| Run | same | strength | settled vs open | flips |
|---|---|---|---|---|
| sub-links-only | 12 | 9 | 2 | **1** |
| sub-incremental 1 / 2 / 3 | 13 / 15 / 14 | 4 / 4 / 6 | 7 / 5 / 3 | 0 / 0 / **1** |
| 35b-plain 1 / 2 / 3 | 12 / 4 / 10 | 3 / 6 / 9 | 6 / 7 / 3 | 3 / **7** / 2 |
| 35b-plain, `--cap-rivals 4` | 12 / 9 / 10 | 3 / 7 / 9 | 6 / 5 / 3 | 3 / 3 / 2 |
| 35b-signrule 1 / 2 / 3 | 12 / 12 / 14 | 4 / 3 / 2 | 7 / 7 / 6 | 1 / 2 / 2 |

| Runs that wrote their own claims | claims | of my 24 | matched verdicts same | strength | flips |
|---|---|---|---|---|---|
| sub-claims-and-links | 19 | 11 | 8 | 2 | 0 (1 settled vs open) |
| 35b-detect-1 | 26 | 8 | 4 | 3 | 1 (probably a mapping error) |
| 35b-detect-2 | 27 | 7 | 4 | 3 | 0 |

## What it showed

- **The product's model is worse than the subagents** (12-14 same, 1-2 flips with the sign rule and 2-7 without, against 13-15 and 0-1), and it finds fewer of my links (7-33% against 51-58%). Keepers over-link: 29-109 links against my 43.
- **A rival set can cascade.** Plain chain 2 wrote one question with 20 rivals; one true claim then contradicted nineteen others (7 flips). Dropping sets over four fixes it, and the model now refuses them (a set holds two to four). With no rival sets at all most chains flip more, so the rule helps when its sets are small and exclusive.
- **The sign rule in the brief helps a little** (about one flip fewer per chain; only three chains).
- **Where flips come from:** the same three claims in most chains: "nothing could get into Julia's room and the rooms have no communication" (compound; the subagents split it into `parts` as the ventilator appeared, the 35B did not), "a hideous child ran across the lawn" (linked to the baboon as confirming: it replaces the claim), and the shutter-bar clang (linked to topic-adjacent events, missing the one event that undermines it). In the first whole-story run a flip came from using Holmes's own theory as decisive evidence: an event where someone asserts something shows it was said, nothing more.
- **Half the extra links are noise.** A blind judge rated 45 random links the keepers made that my key lacks: 19 right (42%, so my key under-links), 22 not evidence (49%, nearly all weak `supports` on a related event), 3 wrong direction (7%), 1 too strong.
- **Claim detection misses the competing theories.** Per slice, the 35B finds about as many claims as I have (26, 27) but mostly steps of Holmes's reasoning; of mine it finds a third, and none of the rival explanations (fear, the gypsies, the clang, the sealed room, the official finding): the claims a game master most needs.
- **Not helpful, so not built:** a second pass asking each link's effect on its own (`signcheck35.py`; it dropped both opposite-signed links shared with my key but also seven correct ones, flips unchanged); an automatic cap or drop of links to assertion events (`--cap-assertions`, `--drop-assertions`: no reliable effect); requiring two decisive links before `true`/`false` (`--two`: the flips stay, more verdicts become open).

## For play

1. Model-written claims are not ready to decide what a character is told. Verdicts from them are the keeper's view, labelled, until a person confirms.
2. The claim-free parts of the model (who knows what, overlap, held hooks, deadlines, ties, groups) need no model to derive, and are tested against the text.
3. Next, on the real thing: the keeper through the real prompt on a play transcript; a "which theories compete here" pass for missing rival sets; a pairwise check that two rivals really exclude each other.

## Limits

One story, one key written by one reader (the judge found it misses about 40% of the extra links a model proposes); the keepers saw constrained JSON over events, not the product's tools; each run is one sample at low temperature.
