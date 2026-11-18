---
name: world-info
description: What the world says about itself in world.json (description, tags, rules, openings, start questions, time) and how edit_world_info changes it.
when_to_use: Before you call edit_world_info, or when you write or reshape an opening, an alternate opening or the questions the start dialog asks.
---

# The world's own information (`edit_world_info`)

`edit_world_info` changes only the fields it is given. Read `get_world_info` first: a list you send (tags, rules, alternate openings, start questions) replaces the whole list. The name, preset, lorebooks, sampling and tool switches are the person's and cannot be changed here.

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `description` | text | A short summary of the world, a few sentences. The catalogue and the worlds page show it; it is not read by the story. |
| `tags` | list of text | A few short words so a person can find the world. |
| `rules` | list of text | Rules of the world the game master must keep, in your words, one rule each. Not style and not a character's behaviour: see `world-where-things-go`. |
| `opening` | text | The first message of a story, as plain narration. |
| `openingParts` | list | The same opening as ordered parts (below). Give `opening` or `openingParts`, never both; giving one replaces the other form. |
| `alternateOpenings` | list | Other first messages the player may pick: `{ "title", "text" or "parts", "character"? }`. `character` is the id of the character it is for. |
| `startQuestions` | list | Questions the start dialog asks (below). |
| `startingTime` | text | The local story time a story starts at, as `1912-09-21T19:30`. |
| `timeZone` | text | An IANA zone such as `Europe/London`; the story's clock is written in it. |
| `version`, `authorName`, `authorUrl` | text | Attribution. |

## Openings

An opening is plain text when it is only narration, and parts as soon as a character speaks:

```json
[
  { "type": "narration", "text": "The fog lifts from the harbour." },
  { "type": "utterance", "character": "keeper", "text": "You are late." }
]
```

- The speaker is the character's id from `list_characters`. A speaker you are not sure of stays narration; an unknown id is refused.
- When you only change the form of an opening (plain to parts or back), call `reshape_opening`: it keeps every word. Retyping the opening here can lose words, and an edit that changes them is flagged.
- To correct who speaks a line, or to change the words, use `openingParts` here.
- An alternate opening takes `text` or `parts`, not both.

## Start questions

`startQuestions` lets the world ask the player how the story should begin: two to eight questions at most, each `{ "id", "text", "options" }` with two to eight options, each `{ "id", "label", "description"?, "effect" }`. The player may leave one unanswered, and then nothing changes. An effect may set only these, in these spellings (any other key is refused):

| Key | Effect |
| --- | --- |
| `rules` | List of text added to the story's own rules. |
| `opening` | The position (from 0) of the alternate opening to start with. |
| `startingTime` | The local story time to start at. |
| `clockMode` | `simulated` or `real`. |
| `tools` | Optional tool switches by kind of agent, as in the world's `tools`. |
| `plots` | Plot id to `dormant` (waits) or `available` (may be taken up from the start). |

`{}` is a valid effect and changes nothing. Two answers that set the same single value differently refuse the start, so give one question one job.

```json
[{
  "id": "tone",
  "text": "How dark should it get?",
  "options": [
    { "id": "grim", "label": "Grim", "effect": { "rules": ["No one is spared by luck alone"], "plots": { "heist": "available" } } },
    { "id": "light", "label": "Light", "effect": { "rules": ["Nobody dies unless the player chooses it"] } }
  ]
}]
```

## Design notes

- Put in `rules` only what is true of the whole world. A rule that only applies to one question's answer belongs in that option's effect.
- Use the opening to set a scene, not to explain the world: a story reads it as the first thing that happened.
- Keep `description` for the person browsing worlds; do not repeat it in the opening.
