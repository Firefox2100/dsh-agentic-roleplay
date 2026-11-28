# Story model v2

The model the roleplay system would use to hold a story: what happened, who knows what, what is claimed and how well, what is still to come. It is called v2 because the project's v1 is today's formats and an earlier evolved draft was never published (kept in `archive/draft-v2.tar.gz`, with `MODEL-V2.md` of that time).

It was found by encoding nine public-domain works and checking the result with a validator (`validate.spec.ts`); the works and the findings are in [README.md](README.md). This document is the model as it now stands, what each part is for in play, which surface may show it, and how it lands in the real state.

## 1. Principles

1. **Events and states are the truth.** What happened is stored once, with no accuracy or truth flag on anything that is a belief.
2. **A claim has no truth field.** Its verdict is derived from the events that bear on it.
3. **Time comes from the clock.** Order inside a scene is text order; across scenes only stated `after`/`before`; real intervals only where the work gives them.
4. **Telling is a projection.** How a story is told (order, narrator, layers of reporting) is not stored. It matters for imports and analysis, not for play.
5. **A missing edge is not knowing.** Nothing is assumed from silence: a missing perception means the person did not take it in; a missing event does not mean it did not happen.
6. **Roleplay first.** Each part is rated by what play needs: who may know what now, what the game master may reveal, what the keeper writes each turn.

## 2. Document layout (`v2/story.json`)

| Key | Holds |
|---|---|
| `work`, `model` | Title and the model's name (`v2`). |
| `entities` | `people` (`id`, `name`, `kind`: person, group or animal; groups may carry `may_include`), `places`, `things`. |
| `time` | `epochs`: separate time bases for works that date their pieces in incompatible ways; `ties`: map one base onto another under a claim. Optional. |
| `events` | What happened. |
| `states` | What was the case over a span (a circumstance, a condition, a holding). |
| `knowledge` | Who knew, believed, doubted or was unaware of what, and from when. |
| `held` | What a person anticipates or intends, with conditions, deadlines and amounts. |
| `claims`, `questions` | What is asserted and the rival-claim sets. |
| `readings` | Interpretations and counterfactuals (analysis only). |
| `frames` | Non-actual sequences (one use in nine works; analysis only). |
| `gaps_found` | Notes on what the encoding could not hold. Not part of the model. |

`v2/checks.json` holds what the validator compares derived answers to: written from the text before the records, with corrections logged and later additions marked `post_hoc`.

## 3. Events

| Field | Meaning |
|---|---|
| `id`, `kind`, `text` | Identity, a free label, one line of what happened (present tense). |
| `when` | `seq` (order in the story), optionally `t` (an interval `[from, to]` in minutes on an `epoch`), `approx`, `gap`, `precision`, `within` (a parent interval), `after`/`before` (ids). |
| `place`, `who` | Place id; people with a `role`: agent, patient, speaker, addressee, witness, observer, present, overhearer, and others (open list). |
| `things` | Thing ids involved. |
| `origin` | Omitted = played. `offscreen` (happened out of sight), `backfilled` (happened earlier and became known later); both carry `established_in`, the event where the reader learns it. |
| `scene` | Events with the same `scene` are ordered by `seq` without stated ties. |
| `audience` | Who a line or act was for. Without it, the people present plus hidden listeners (see `conceal`). |
| `kind: conceal` with `from` | The act of hiding something; `from` lists who it is hidden from. |
| `causes` | `[{event}]`: what led to this. |
| `fulfils`, `prevents` | The held item this event settles (see 6). |
| `says`, `reported_by`, `frequency`, `intent`, `effects`, `importance`, `manner`, `mode` | Optional detail kept where a work needs it (a speech's words, who reported it, repeated events, a stated aim, changes to values, weight, how it was said). |
| `src` | Paragraph ids of the source; every paragraph must be covered by some record. |

The six first conversions also carry `basis` (stated, implied, reported), `frame`, `tale` and a few others; later works dropped them. The validator accepts both.

## 4. States, knowledge, readings

- **State**: `of`, `kind`, `value`, `from`, `until`, optional `unit`, `precision`, `status`.
- **Knowledge row**: `who`, `of` (an event, state, claim, held item or reading), `stance` (knows, believes, doubts, unaware), `from`, `until`, `how` (seen, heard, overheard, told, read, reasoned, inferred, asleep, unseen, did), `source`, `note`, and for a wrong belief `believes_instead`. Moments are `start`, an event id, or `para:Pn` (a position in the text, for the reader). `from`/`until` of a row are moments; an `unaware` row overrides every other way of knowing (a sleeper does not know what happens beside them).
- **Reading**: `holder`, `text`, `supports`/`against`, `kind` (hypothetical, counterfactual). Not used in play.

## 5. Claims, verdicts, rival sets

A claim: `id`, `text`, `by` (a person or a group such as an inquiry), `asserted_in` (the event where it is first made), `bears_on` (a list of `{ref: event, as: confirms|contradicts|supports|undermines}`), optional `cites` (whom it quotes), optional `parts` (each with its own `bears_on`), optional `status`.

**Verdict** (record's view): from the bearings known by the time asked.

| Bearings | Verdict |
|---|---|
| confirms and contradicts | disputed |
| contradicts only | false |
| confirms only | true |
| supports and undermines | open |
| supports only | likely |
| undermines only | unlikely |
| none | unresolved |

A claim with `parts` is `mixed` when its parts differ. A link counts only once both the claim is made and the event is known.

**Rival sets** (`questions`: `id`, `text`, `rivals`): two to four claims that are mutually exclusive answers to one question. A rival that is `true` on its own bearings adds a `contradicts` to the others; one that is `likely` adds an `undermines`. Only a rival's own bearings count (never its adjusted verdict), so there is no cycle, and a rival that is false or unlikely never lifts the others. A set has at least two and at most four members; a larger cluster is split into questions that are each exclusive.

**Status.** `status` is omitted or `confirmed` for a claim a person has settled the wording and links of; `proposed` for one a model wrote. A proposed claim gets verdicts like any other, labelled as the keeper's view, and is not used where a character or the player would be told it as settled (section 9).

**Verdict for a person** (`verdict_for(person, moment)`): the same rules over only the events that person knew at that moment, with rival adjustment and parts. This is the character's own view and can be `true` for a claim the record only reaches later.

## 6. Held items

A held item: `who`, `text`, `from` (the moment it begins), optional `if` (other held items it depends on), `due` (a time on the events' clock), `amount` (`value`, `unit`), `payer`, `payee`. Events settle it with `fulfils` or `prevents`.

| Derived state | When |
|---|---|
| `fulfilled` / `prevented` | an event settles it |
| `void` | a condition was prevented |
| `waiting` | a condition is not yet fulfilled |
| `open` | none of the above |
| `overdue` | `due` has passed and nothing settles it. **Not** `lapsed`: a silent text does not say it did not happen |
| `on-time` / `late` | once fulfilled, against `due` |
| owed | the held items with an amount whose `payer` is a person, `due` or `conditional` |

`overdue` reads on two clocks: the record's view (nothing has been shown yet) and the world's view (the fulfilling event's time is before now). They differ when the story tells a thing late.

## 7. Derived views

What each view answers, and its rule. All are computed from the above; none is stored.

| View | Answers | Rule |
|---|---|---|
| `knows_at(person, event, moment)` | Does this person know of this event now? | They took part (a role other than overhearer), or heard it (presence or `audience`, plus hidden listeners from `conceal`), or a `knows`/`believes` row covers the moment. An `unaware` row overrides. |
| `knows3` | Knows, possibly, or no | `knows` as above; `possibly` if a group that witnessed it declares the person in `may_include` and no `unaware` row; otherwise `no`. |
| `heard_by(event)` | Who took this in | Audience if stated, else the people present, plus hidden listeners; the overhearer does not count as a party. |
| `order` | Partial order of events | `seq` in a scene, stated `after`/`before` across scenes; nothing else. |
| `overlap3(a, b)` | Could they be at once | `definite` (both exact and overlapping on one epoch), `possible` (one only inside a parent interval), `none`. A different epoch gives `none` unless tied. |
| `gap(a, b)` through `ties` | How long between | Same epoch: exact. Across epochs: one value per tie, each with the verdict of the claim it depends on. |
| `verdict_at`, `verdict_for` | See section 5 | |
| `false_beliefs` | What does this person believe that is untrue | A `believes` row whose claim derives false or unlikely. |
| `lies` | Is this a lie | The asserter was a party to, or knew by a row of, an event that contradicts the claim or confirms its rival. Overhearing does not count. |
| `cites_unheard` | Does a claim quote someone it could not have heard | The cited person never spoke before the claim. |
| `rests_on_untrue` | Does an event rest on a false claim | Through `causes`, from an event to the event asserting a claim that derives false or unlikely. |
| `held_outcomes`, `owed`, `timeliness` | See section 6 | |
| `told_late` | Which events are told after later ones | Analysis only. |

## 8. Rules fixed in this stage

1. A rival set has two to four members, mutually exclusive. The validator refuses others.
2. `confirms`/`contradicts` are for events that state a plain fact; an event where someone only says or argues something supports or undermines. This is authoring guidance. Applied as an automatic cap it did not improve the keeper experiments (see README), so it is not a derivation rule.
3. Verdicts of `proposed` claims are the keeper's view and never go to a character or the player as settled.
4. `overdue` is not `lapsed`.
5. Two clocks: the record's view (what has been shown) and a person's view (what they know). Every question about truth names which.
6. Crowds are groups with declared `may_include`; nothing infers who stood in a crowd.
7. `unaware` overrides every other way of knowing.
8. Accuracy of a belief is never stored; it is the verdict of its claim, read at a moment.

## 9. Three surfaces

The standing rule: the world editor sees and edits everything; the chat shows only what the player directly perceives; the sidebar shows state visible to the player's character. Where each part goes:

| Part | World editor | Chat | Sidebar (player's character) |
|---|---|---|---|
| Events | all, with `origin` and `established_in` | those the player's character took in, as narration | the journal: events the character knows |
| Knowledge rows, `knows_at`, `knows3` | all | none | only the player's character's own |
| `conceal` and `from`, `unaware` | all | **never** (it would reveal the secret) | none, until the story reveals it |
| Claims (text, by, bearings) | all, with `status` and verdict | none | those the character holds or has heard, never their truth |
| Record verdict (`verdict_at`) | all | none | **never** |
| `verdict_for` the player's character | all | none | the character's own view of what they know ("you think this likely"); never the record's truth |
| Rival sets | all | none | an open question both of whose claims the character knows |
| Proposed claims | all, with confirm and reject | none | none |
| Held items, plans, hooks (`if`, deadlines) | all | none | only the character's own and those they know of (the quests list) |
| Debts and amounts (`owed`) | all | none | those the character knows |
| `overlap3`, alibis, `told_late`, `ties`, epochs, readings | all | none | none |
| `false_beliefs`, `lies`, `rests_on_untrue` | all | none | none: they reveal truth |

Anything that derives truth the player's character does not hold is editor and game-master only.

## 10. Who writes what

| Part | Written by | When |
|---|---|---|
| Events | the game master's round results; the keeper enriches them | each round (as today) |
| Who perceived what | the keeper | each round (as today) |
| `conceal` events and `from` | the keeper (from the game master's outcome) | when a hiding act is played |
| Held items, `due`, `amount` | the keeper, from commitments and goals (as engagements and intents today) | when made |
| Claims and links | the keeper proposes (`status: proposed`); the game master or the person in the editor confirms | each scene, never silently |
| Rival sets | with the claims, only when exclusive | |
| Groups' `may_include` | the game master or the editor | when a crowd is introduced |

## 11. Mapping to the real state

What exists today (state package, migrations 1 to 12) and what each part needs. The schema is frozen: every change is a new, consecutive migration.

| Model part | Today | Needed |
|---|---|---|
| Events (played) | `events` (turn, round, text, importance, tags, location), `event_involves`, `event_items`; instant from `clock.at(turn, round)` | Nothing for play. Optional `role` on `event_involves`; `kind` is carried by tags. Intervals (`t`, `within`) are not needed in play: a round is the unit. |
| `offscreen`, `backfilled` | none | Optional `origin` and `occurred_at` columns, only if the keeper must record events older than the round that reveals them; else a backfilled event is a new event with the earlier instant in its text. |
| Who knows what | `perceptions` (mode witnessed, heard, told, inferred; `accuracy` accurate, partial, mistaken); closed-world `entity_knowledge`; sleep windows and holds | `knows_at` is a query over these plus presence and sleep: no new table. `accuracy` stays a stored field written by the keeper (it feeds fading memory); the model derives it, so the two are compared in checks, not merged. |
| `conceal` and `from` | none | A way to record a hidden listener or a hidden act: one table `event_concealment(event_id, from_character_id)` or a `hidden_from` on `perceptions` absences. Needed for `heard_by`. |
| Beliefs held by a character | `memories` (kind belief) with `memory_evidence` (supports/contradicts perceptions); reflection turns contradictions into doubts | A belief is a claim held by a person; its evidence is already the bearing. Extend: `memory_evidence.relation` adds `confirms` and `undermines`, and evidence may point to an event, not only a perception. |
| Claims by others (an inquiry, the narrator, a rumour), `parts`, rival sets, `status` | none | New tables: `claims` (text, by, asserted_event_id, status, memory_id optional), `claim_bearings` (claim_id, event_id, as, part), `claim_questions` and `claim_question_members`. Game-master-private. |
| Held items | `intents` (need, obligation, quest, agenda, ...; status; horizon), `engagements` (`at_ms`, `until_ms`, status pending, kept, missed, cancelled; participants), `story_threads` (open, resolved, `player_knows`), plots (`PlotDefinition`/`PlotProgress`), the story plan (private to the game master) | Deadlines already exist as engagements and goal deadlines; `overdue` is an engagement pending past `until_ms` (the code's grace is 30 minutes). `if` (dependencies) maps to plot `prerequisites`. Amounts stay numeric variables and items; the obligation is an intent of type obligation; `owed` is a view over intents and variables, no table. |
| Groups | characters with `kind: group` and a tier | `may_include`: a `character_members(group_id, member_id)` table, optional. |
| Time bases and ties | one clock per story | None for play; imports and analysis only. |
| Readings, frames, `told_late`, `says` detail | none | Not carried. |
| Verdicts and views | none | Computed in code from the above, never stored, except a proposed/confirmed `status`. |

Not needed for play, therefore not carried: readings, frames, epochs and ties, telling order, `basis`.

## 12. Evidence

Nine works encoded (six short stories in three ways; a detective story, a play excerpt and a novel chapter directly in v2), 24 validator tests green, every paragraph of every source covered by some record.

- **Blind keys.** Keys were written before the links in the three direct works; each round corrected a few of the author's own slips, listed in `v2/checks.json`.
- **What the direct works added to the model:** conditions on held items, `lies` and `cites_unheard` as derived checks, compound claims (`parts`), rival sets, `scene` order, `audience`, concealment with `from`, the sleeper override, three-valued overlap, the second clock (`verdict_for`), then groups, deadlines, amounts and ties.
- **Keeper experiment** (`keeper-links/`, Speckled Band, 24 claims): model-written links agree with the key on about 60% of verdicts, differ in strength or leave it open on about 35% (safe for play), and flip a few verdicts: 0 to 1 of 24 on a stronger model, 1 to 7 on the product's own (1 to 3 once oversized rival sets are dropped). The same model found about a third of the claims that matter and none of the rival theories. Hence `status` and the rule that a proposed claim never reaches a character as settled.
- **Rival sets.** Well formed sets removed flips (one chain went from 3 to 1); an over-wide set cascaded (7 flips from a set of 20), hence the 2 to 4 rule.
- **Not helpful, so not built:** a second pass asking each link's sign alone, an automatic cap on assertion events, a two-decisive-links rule.

## 13. Still open

- The real keeper prompt on a play transcript (the experiments used constrained JSON over events).
- A pass that asks "which theories compete here" to recover missing rival sets, and a pairwise exclusivity check.
- Deriving who stood in a crowd instead of declaring it.
- The exact table design for claims and concealment, to settle with the first implementation and the benchmarks.
