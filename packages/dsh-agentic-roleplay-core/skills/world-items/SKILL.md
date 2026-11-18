---
name: world-items
description: The item.json format: things that matter by identity, possession or condition; where they start; containers, wearables, slots.
when_to_use: Before you create or replace a thing with create_world_element or replace_world_element (kind item).
---

# Items (`kind: "item"`)

Use an item for a thing whose identity, possession, condition or use matters. Put fixed scenery in a place's description or features.

## Fields

`name` is required. **Exactly one** of `location`, `held_by`, `worn_by` or `inside` says where it starts: a flat field, not an object.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | text | Required. |
| `description` | text | What it is. |
| `quality` | text | Its condition ("chipped", "freshly oiled"). |
| `quantity` | whole number, at least 1 | Default 1. A `unique` item is one thing: leave the quantity out. |
| `unique` | true/false | Only one exists. |
| `notable` | true/false | Always worth mentioning when present. |
| `hidden` | true/false | Invisible and unreachable to characters until revealed. |
| `location` | key of a place | Where it lies. With optional `position` and `feature` (`feature` needs `location`). |
| `held_by` | key of a character | Carried. |
| `worn_by` | key of a character | Worn; the item must also have `wearable`. Optional `position`. |
| `inside` | key of another item | In a container. Optional `position`. |
| `wearable` | slot id | Lowercase letters, digits, `-` or `_`. Default slots exist; a world may add its own in `slots.json`. |
| `container` | object | `{ "state": "open" or "closed" or "locked", "opened_by": [item keys, at most 10] }`. The item holds other things. |
| `owner` | key of a character | Who it belongs to, which may differ from who holds it. |
| `visual_identity` | object | `{ "description", "tags", "negative_tags" }`. |
| `variables` | object | Initial values of declared item variables. |

## Design notes

- Possession, condition and placement change in play; the file holds only the beginning.
- A locked door or container is opened by an item that is in hand: list its key in the exit's or container's `opened_by`.
- Do not use items for abstract state (a reputation, a debt). Use a variable.
- A character carrying it from the start: `held_by` with the character's key; make the character first or in the same turn.

## Example

```json
{
  "name": "Brass lantern",
  "description": "A hand-held lantern with a cracked lens.",
  "quality": "dented",
  "notable": true,
  "held_by": "clara-whitlock"
}
```
