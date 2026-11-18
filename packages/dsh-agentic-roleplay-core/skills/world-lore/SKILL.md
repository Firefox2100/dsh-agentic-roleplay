---
name: world-lore
description: The lore.json format: canonical facts of the setting, who knows them, how they link to entities; what to put in lore and what not.
when_to_use: Before you create or replace a lore entry with create_world_element or replace_world_element (kind lore).
---

# Lore (`kind: "lore"`)

Lore holds **canonical facts of the setting** that are better kept as text than as a character, place, item or faction: history, customs, beliefs, legends, how things work. One independent entry per fact that could be learned separately.

## Fields

`title` is required. Everything else has a default.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | text | Required. Also what a character sees in its list of known background, so make it say what the entry is about, or when it applies. |
| `kind` | `history`, `culture`, `religion`, `politics`, `geography`, `science`, `custom`, `legend`, `other` | Default `other`. |
| `summary` | text | One sentence. |
| `body` | **one string** | The facts, as prose. Not a list, not an object. Use `\n\n` for paragraphs. |
| `scope` | `everyone` or `listed` | Default `listed`. `everyone` is common knowledge any character can look up; `listed` is for the game master and the characters named in `known_by` or in a character's `knowledge.lore`. |
| `known_by` | list of text | Character keys, names or aliases. Only with `scope: "listed"`: with `everyone` it is refused. |
| `subjects` | list of objects | The entities the entry is about: `[{ "kind": "character" or "faction" or "location" or "item" or "lore", "id": the key }]`. Not a list of strings. Used by retrieval. |
| `related` | list of lore keys | Other entries it connects to. |
| `sources` | list of text | Where the fact comes from. |
| `starts_at`, `ends_at` | ISO date or date-time | When the fact holds. `ends_at` must not be before `starts_at`. |

## Design notes

- Facts, not instructions. "The guild closes its gates at dusk" is lore. "Always describe the guild coldly" is a style instruction and belongs in the world's prompts.
- Secrets: `scope: "listed"` with `known_by` naming who knows. An entry with a secret is never `everyone`.
- Characters do not know lore unless it is `everyone`, listed for them, or in their `knowledge.lore`. A missing edge means not knowing.
- One entry per independent fact. Link `subjects` so retrieval can find it.
- Do not use lore for changing state (where something is now, who holds it).

## Example

```json
{
  "title": "The 1891 incident",
  "kind": "history",
  "scope": "listed",
  "known_by": ["arthur-moore"],
  "summary": "What the Trust has kept out of its public history.",
  "body": "In the winter of 1891 the observatory's second telescope failed during a public viewing.\n\nThe Trust paid the witnesses to stay quiet.",
  "subjects": [{ "kind": "location", "id": "observatory" }, { "kind": "faction", "id": "observatory-trust" }],
  "related": []
}
```
