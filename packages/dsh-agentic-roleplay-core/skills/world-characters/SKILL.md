---
name: world-characters
description: The character.json format: required and optional fields, allowed values, what each field is for, what to leave out.
when_to_use: Before you create or replace a character with create_world_element or replace_world_element (kind character).
---

# Characters (`kind: "character"`)

One document per character, snake_case keys. `create_world_element` takes the key (the stable id) and the complete document; the document's `id` is set from the key. Read an existing one with `get_world_element_source` before replacing it.

## Fields

Only `name` is required. The rest has defaults.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | text | Required. |
| `aliases` | list of text | Nicknames and other names. Not titles: a title follows from what the character does. |
| `role` | `playable` or `npc` | Default `npc`. A playable character must be a `person` and cannot be `background`. |
| `kind` | `person` or `group` | Default `person`. `group` is a crowd. |
| `tier` | `principal`, `supporting`, `background` | Default `principal`. |
| `age` | text or non-negative number | Free text is fine ("about forty"). |
| `gender`, `pronouns` | text | Optional and separate. Leave both out and nothing is shown or guessed. |
| `voice` | text | The speaking voice used for audio. Leave out unless you know it. |
| `summary` | text | One or two sentences: who they are. |
| `personality` | text | Prose. Keep every concrete fact. |
| `background` | text | Prose. |
| `appearance` | text | Prose. |
| `speech` | object | `{ "style": text, "examples": [text, ...] }`. Examples are lines they say. |
| `visual_identity` | object | `{ "description", "tags": [...], "negative_tags": [...] }`. Only what stays the same across scenes. |
| `start` | object | The state when the story begins (below). |
| `relationships` | list | `{ "to": character id, "label": text, "summary": text, "familiarity": 0..1, "trust": -1..1, "affinity": -1..1, "tension": 0..1 }`. One profile per other character; `to` and `label` are required. |
| `knowledge` | object | `{ "locations": [ids], "items": [ids], "exits": [{ "from": id, "to": id }], "lore": [ids] }`. What the character knows exists. |
| `routine` | list | Recurring windows (below). |
| `variables` | object | Initial values of declared variables for this character. |

### `start`

`public_state` (what anyone present can see), `activity` (what they are actually doing), `inner_state` (private), `location` (the key of an existing place), `position` and `feature` (need a `location`), `emotion` (`{ "baseline": {"valence", "arousal", "dominance"} }`, each -1..1; `baseline` is required when `emotion` is given), and `intents`: a list of `{ "name" (required), "type", "description", "status", "horizon", "priority": 0..1, "urgency": 0..1, "plan": [text], "open_threads": [text], "constraints": [text], "deadline": ISO date-time }`. Intent `type` is one of need, obligation, quest, agenda, aspiration, relationship, habit, reaction; `status` active, paused, completed, failed, abandoned; `horizon` immediate, short, day, long, open_ended.

### `routine`

Each window: `from` and `to` as `HH:MM` (required, different), `activity` (required), optional `days` (`mon`..`sun`), `on` (day tokens, see `world-calendar`), `location`, `feature` (needs `location`), `position`, `interruptible` (true/false), `sleep` (true/false). A window ending before it starts crosses midnight. At most a few dozen windows.

## Design notes

- `summary`, `personality`, `background`, `appearance` and `speech` feed different prompts: do not collapse them into one biography.
- A missing `knowledge` entry means the character does not know. Do not encode changing facts there.
- Faction membership is written in the faction's `members`, not on the character.
- Guides for how the character reacts in specific situations belong in lore scoped to them or in a trigger cue, not in `personality`. See `world-where-things-go`.

## Example

```json
{
  "name": "Mara Vale",
  "aliases": ["Dr Vale"],
  "role": "playable",
  "summary": "An astronomer who returned to investigate her mentor's disappearance.",
  "personality": "Patient in public, relentless in private.",
  "background": "She grew up below the observatory.",
  "appearance": "Tall, dark-haired, usually dressed for bad weather.",
  "speech": { "style": "Precise and restrained", "examples": ["Facts first. Fear later."] },
  "start": {
    "public_state": "Recently arrived from London.",
    "activity": "Reviewing her mentor's notes.",
    "inner_state": "Afraid the old rumours were true.",
    "location": "observatory-library",
    "intents": [{ "name": "Find her mentor", "plan": ["Trace his final observations."] }]
  },
  "relationships": [{ "to": "arthur-moore", "label": "former colleague", "trust": 0.2 }]
}
```
