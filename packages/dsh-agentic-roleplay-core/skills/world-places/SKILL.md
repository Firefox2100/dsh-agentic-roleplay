---
name: world-places
description: The location.json format: places, features, exits, containment, travel and locks.
when_to_use: Before you create or replace a place with create_world_element or replace_world_element (kind location).
---

# Places (`kind: "location"`)

One document per place. Only `name` is required.

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `name` | text | Required. |
| `description` | text | What a character sees on arriving. Fixed scenery belongs here. |
| `parent` | key of another place | Containment ("the library is in the observatory"), not travel. No cycles. |
| `features` | list | Addressable parts of the place: `{ "id": letters, digits, `-` or `_`, at most 60, "name": text, "description": text }`. Ids are unique within the place. |
| `exits` | list | Ways to other places (below). |
| `visual_identity` | object | `{ "description", "tags", "negative_tags" }`: what the place always looks like. |
| `variables` | object | Initial values of declared place variables. |

### Exits

Each exit: `to` (the key of another place, required), `description` (the door, the path), `one_way` (true/false, default false), `back_description` (what the way back looks like when it is not one way), `travel_time_seconds` (a whole number), `state` (`open`, `locked` or `blocked`; default `open`), `note` (text) and `opened_by` (a list of item keys that open a locked exit). A way that is not `one_way` also creates the way back. At most about thirty exits and thirty features per place.

## Design notes

- Space is a graph of exits; containment (`parent`) is separate. Use `parent` to say what is inside what, `exits` to say how to get from one place to another.
- A feature is something a character can be at or use. Do not make every decorative object a feature.
- Make the places a character starts in before the characters.
- A place that nothing can reach is a lint finding: give it an exit or a parent.
- Items that unlock a way are written on the item side as keys in `opened_by`; make the item as well.

## Example

```json
{
  "name": "Observatory Library",
  "description": "A circular room lined with damp astronomical journals.",
  "parent": "observatory",
  "features": [{ "id": "catalogue", "name": "Card catalogue", "description": "Several drawers are missing." }],
  "exits": [{
    "to": "observatory-hall",
    "description": "A brass-bound oak door",
    "travel_time_seconds": 20,
    "state": "open"
  }]
}
```
