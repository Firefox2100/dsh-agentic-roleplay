---
name: world-variables
description: The variables.json format: tracked numbers, flags and choices, their update rules, and when something should be a variable.
when_to_use: Before you replace the world's variables with write_world_file (kind variables), or when you are deciding whether something should be tracked.
---

# Variables (`write_world_file`, kind `variables`)

`variables.json` is a **list** of declarations, sent as a list (not wrapped in an object). Use a variable for a fact that needs a deterministic test or a number that moves: whether an alarm is on, how many seals remain, a character's tiredness.

## A declaration

`key` and `name` are required.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | text | Used in conditions and tools. |
| `name` | text | |
| `kind` | `number`, `flag` or `choice` | Default `number`. |
| `subject` | `character`, `item`, `location` or `world` | What it is about; default `character`. A `world` variable has no subject. |
| `only` | list of keys | Limit it to these characters, items or places. |
| `min`, `max` | numbers | Limits of a number: copy the limits the person gave. |
| `integer` | true/false | Whole numbers only. |
| `options` | list of text | The allowed values of a `choice`. |
| `default` | number, true/false or text | Its initial value. |
| `visibility` | `public`, `private` or `hidden` | Who may read it. Hidden values are never shown to the player or other characters. |
| `bands` | list | Words for ranges: `[{ "up_to": number, "label": text }]`. |
| `baseline` | true/false | A value that drifts back to a baseline (a temperament). |
| `always` | true/false | Always shown in a brief. |
| `description` | text | What it measures. |
| `update` | text | **When and how it changes.** A sentence, for example "rises by 1 for each hour of hard work, falls with sleep; talking or reading changes nothing". Without a clear rule a value moves for nothing. |

Initial values for a given character, item or place go in that entity's own `variables` object, keyed by the variable's key.

## Design notes

- Do not turn prose state into a variable because it can be counted. Relationships, knowledge, placement and item state already have their own models.
- Say in `update` what does **not** change it as well as what does.
- `description` and `update` are what the game master and the check after each turn read: write them for that reader.
- Feelings (valence, arousal, dominance) are built in; do not declare them.
- A world has a limited number of variables (60). Prefer few that matter.

## Example

```json
[
  {
    "key": "tiredness",
    "name": "Tiredness",
    "kind": "number",
    "subject": "character",
    "min": 0,
    "max": 10,
    "integer": true,
    "default": 0,
    "visibility": "public",
    "description": "How worn out the character is.",
    "update": "Rises by 1 for each hour of hard work, falls by 3 with a night's sleep; talking or reading changes nothing.",
    "bands": [{ "up_to": 3, "label": "rested" }, { "up_to": 7, "label": "tired" }, { "up_to": 10, "label": "exhausted" }]
  }
]
```
