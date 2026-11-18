---
name: world-dice
description: The dice.json format: the world's own checks, dice notation, comparison, bands and what a roll means.
when_to_use: Before you replace the world's dice checks with write_world_file (kind dice), or when a world needs uncertain attempts settled by rolls.
---

# Dice checks (`write_world_file`, kind `dice`)

`dice.json` is an object with a `checks` list: `{ "checks": [...] }`. The project ships no dice rules: the world decides what a roll means. The dice are rolled by code; the game master is told which band the roll fell in and narrates it.

## A check

`key`, `name`, `use`, `dice` and `bands` are required.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | text | Lowercase letters, digits, `-`, `_`, starting with a letter. Unique. |
| `name` | text | |
| `use` | text | When the game master rolls it, in your words. The game master reads this to choose between checks: say what kind of attempt it is for. |
| `dice` | text | Notation: `NdM`, `d%`, terms added or subtracted (`2d6+1`), `kh`/`kl` keep and `dh`/`dl` drop (`4d6kh3`). At most 100 dice of at most 1000 sides and eight terms. |
| `reading` | `total` (default) or `successes` | `successes` counts dice showing at least `hit`, which is then required (a whole number, at least 1). |
| `compare` | `absolute` (default), `over` or `under` | `over`: how far the total is above a target the game master gives. `under`: how far it stays below one. |
| `modifier` | text | The key of a number variable of the acting character, added to the total. |
| `bands` | list of one to twenty | `{ "min": number, "max": number, "label": text, "result": "succeeded" or "partial" or "failed", "critical": true/false }`. A missing `min` or `max` runs on without end; the first band that holds the value wins. `label` and `result` are required. |

## Design notes

- Leave no gap between bands. A check that can give a value no band holds refuses the world when a story starts; for `over` and `under` the gap fails at roll time.
- The game master rolls only when an attempt can go either way and matters. Say that in `use`.
- A world has at most 40 checks.

## Example

```json
{
  "checks": [{
    "key": "skill",
    "name": "Skill check",
    "use": "A character attempts something difficult where failure has a cost: picking a lock, climbing, persuading a hostile person.",
    "dice": "1d20",
    "compare": "over",
    "bands": [
      { "max": -10, "label": "critical failure", "result": "failed", "critical": true },
      { "min": -9, "max": -1, "label": "failure", "result": "failed" },
      { "min": 0, "max": 4, "label": "partial success", "result": "partial" },
      { "min": 5, "max": 9, "label": "success", "result": "succeeded" },
      { "min": 10, "label": "critical success", "result": "succeeded", "critical": true }
    ]
  }]
}
```
