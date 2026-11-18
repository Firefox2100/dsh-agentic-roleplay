---
name: world-factions
description: The faction.json format: organisations with public and private state, goals, members and relationships.
when_to_use: Before you create or replace a faction with create_world_element or replace_world_element (kind faction).
---

# Factions (`kind: "faction"`)

A faction is a persistent organisation: an institution, a family, a movement, an alliance. It holds lasting state and strategy. A group of people who act together in a scene is a character with `kind: "group"`, not a faction.

## Fields

`name` is required.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | text | Required. |
| `aliases` | list of text | |
| `summary` | text | One or two sentences. |
| `description` | text | What it is publicly. |
| `values` | list of text | What it holds important. |
| `structure` | text | How it is organised. |
| `start` | object | `{ "public_state": text, "inner_state": text, "goals": [...] }`. Goals are the same shape as character intents: `{ "name" (required), "type", "description", "status", "horizon", "priority": 0..1, "urgency": 0..1, "plan": [text], "open_threads": [text], "constraints": [text] }`. |
| `members` | list | `{ "character": character key (required), "role": text, "rank": text, "status": "active" or "inactive" or "former", "public": true/false, "commitment": 0..1 }`. A character appears once. `public: false` is a secret membership. |
| `relationships` | list | `{ "to": { "kind": "character" or "faction", "id": key }, "label": text (required), "summary": text, "familiarity": 0..1, "trust": -1..1, "affinity": -1..1, "tension": 0..1 }`. Directional: the other direction is its own record. |

## Design notes

- Goals belong to the faction, not to its members; members feel them as pressure, not as orders.
- Membership has its own role, rank and status. It is written here, never on the character.
- Public state is what outsiders can see; inner state is what the faction hides.
- Make the member characters first, or the document is refused for an unknown character.

## Example

```json
{
  "name": "Blackwater Observatory Trust",
  "summary": "The body that controls access to the observatory.",
  "description": "Publicly charitable and privately divided.",
  "values": ["scientific prestige", "secrecy"],
  "structure": "A board chaired by the town magistrate.",
  "start": {
    "public_state": "Preparing its centenary exhibition.",
    "inner_state": "Trying to suppress records of the 1891 incident.",
    "goals": [{ "name": "Contain the records", "plan": ["Recover missing files."] }]
  },
  "members": [{ "character": "arthur-moore", "role": "archivist", "public": true }]
}
```
