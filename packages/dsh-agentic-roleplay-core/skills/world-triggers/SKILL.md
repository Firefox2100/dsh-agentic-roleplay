---
name: world-triggers
description: The trigger format: conditions, effects (edit, beat, cue), repetition, announcements; when a trigger is the right tool and when it is not.
when_to_use: Before you write or replace a trigger with write_world_trigger, or when something in a world has to happen whenever a condition holds.
---

# Triggers (`write_world_trigger`)

A trigger is something the world does by itself: when a condition becomes true, effects run. It is the right tool when the same condition must always have the same effect. For one-off story moments, or anything that needs judgement, prefer a plot (`world-plots`) or lore.

Give `write_world_trigger` the key (lowercase letters, digits, `-` and `_`, at most 64) and a complete document.

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `key` | text | In the document as well; same rules. |
| `name` | text | Required. |
| `when` | condition | Required (below). |
| `effects` | list of one to six | Required (below). |
| `repeat` | true/false | Default false: fires once. With true it fires again each time the condition goes false and true again. |
| `cooldown_seconds` | whole number | With `repeat`: the least story time between two firings. |
| `chance` | 0..1 | Chance that a rising condition fires; a failed roll uses that rise up. |
| `priority` | number | The higher goes first when several are due. |
| `expires` | local date-time `1912-10-04T19:30` | Never fires after it. |
| `announce` | object | Makes a scheduled event known beforehand: `{ "audience": "everyone" or { "characters": [keys] } or { "place": key }, "text": what is known (never what the effects do), "from": local time, "at": local time }`. Without it a trigger is a secret until it fires. |

## Conditions (`when`, and `while` in effects)

Each is an object with a `type`:

- `time`: `from` and `to` (local date-time), or `window` (`{ "from": "HH:MM", "to": "HH:MM" }`, past midnight when it ends before it starts), `days` (`mon`..`sun`) and `on` (day tokens, see `world-calendar`).
- `place`: `{ "character": key, "location": key, "feature": key }`; `feature` optional.
- `variable`: `{ "variable": key, "subject": key of the character, item or place, none for a world variable, "op": "eq", "ne", "lt", "le", "gt" or "ge", "value": number, text or true/false }`.
- `item`: `{ "item": key, "held_by": character key, "at": place key }`; give either or both.
- `event`: `{ "tag": text }`: an event with this tag was recorded.
- `fired`: `{ "trigger": key }`: another trigger fired.
- `judged`: `{ "text": a statement }`: a model judges the statement true or false about the story after each turn. For what no record can say ("the mayor has lost the town's trust"). It costs a model call per turn and is false until judged: use it sparingly and write statements that can be decided from what happened.
- `all` / `any`: `{ "conditions": [at least one] }`.
- `not`: `{ "condition": one }`.

## Effects

- `edit`: `{ "type": "edit", "edit": { ... } }`, a checked change to the story's records in the record keeper's edit format (events, variable changes, moves, item changes, goals, engagements).
- `beat`: `{ "type": "beat", "text": ..., "while": condition, "draw": [options], "dispatch": "author", "need": ... }`. Something the game master weaves into the story; soft, lapses after a few turns. With `"dispatch": "author"` the world author makes a person instead: give a `need` (`arrival`, `introduction`, `scene_change`, `object`, `variable` or `trigger`) and every beat of the trigger must be of this form; `draw` options stand where the text has `[draw]`.
- `cue`: `{ "type": "cue", "audience": "everyone" or { "characters": [keys] } or { "place": key }, "text": ..., "while": condition }`. Something the audience notices, told to each of them the next time they act. `"@self"` in a `while` condition means the character receiving it.

Text may name things the story has: `{character:key}`, `{place:key}`, `{item:key}`, `{where:character}`, `{holder:item}`, `{value:variable}`, `{value:variable:subject}`, `{time}`. They are filled in when the note is told, not when the trigger fired. A `while` condition withdraws a note whose moment has passed.

## Design notes

- Deterministic conditions are cheap and always the same; use them for schedules, places and tracked values.
- A cue aimed at one character, with a `judged` or variable condition, is the way to say "when X, she does Y" when the condition can be stated. Otherwise write it as lore scoped to that character (see `world-where-things-go`).
- Every key a condition or effect names must exist: characters, places, items, variables and other triggers are checked, and the document is refused with every problem.
- Effects run on the story's records, never on the world files.

## Example

```json
{
  "key": "gas-warning",
  "name": "Gas in the cellar",
  "when": { "type": "all", "conditions": [
    { "type": "place", "character": "clara-whitlock", "location": "cellar" },
    { "type": "variable", "variable": "lamp_lit", "op": "eq", "value": true }
  ] },
  "effects": [{
    "type": "cue",
    "audience": { "place": "cellar" },
    "while": { "type": "place", "character": "@self", "location": "cellar" },
    "text": "You smell gas; {holder:lantern} still has the only light."
  }]
}
```
