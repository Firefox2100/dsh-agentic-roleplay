---
title: Complete world file schema
description: Exact fields, limits, defaults, links, and examples for every authored world file.
---

A world is a folder under the roleplay root's `worlds/` directory. The format
follows the world-simulation-engine export format where it can; differences are
noted. Fields not listed here are ignored, so files can carry data a newer
version understands. Absent fields, `null` and blank strings all mean "not set".

```text
worlds/
  <world folder>/               exactly one folder level; the name is free and not the world's identity
    world.json
    characters/
      <character folder>/       one folder per character
        character.json
    factions/
      <faction folder>/         one folder per persistent organisation
        faction.json
```

Folders without the expected file, files, and symbolic links are skipped.

## `world.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | The world's stable identity, up to 100 characters, unique among the worlds. Sessions refer to the world by it. When a file has none, for example one written by hand or copied from elsewhere, an id is generated and written into the file the first time the world is read, and stays from then on. Two worlds with the same id (a copied folder) are reported, and the later one is not listed. |
| `name` | string | Required. |
| `description` | string | Shown as a tooltip on the world's card. |
| `opening_message` | string or list | Optional. What the story opens with. A new session starts with it before the player says anything, rendered like the output of a turn, and the game master reads it as the first thing that was said. Written once, as authored; nothing is asked of a model. Plain text is one piece of narration. A list gives parts in the order the player reads them: `{ "type": "narration", "text": "…" }` and `{ "type": "utterance", "character": "<character id>", "text": "…" }` (the character's id is its folder name; it must be a character of the world; no `type` means narration). |
| `starting_time` | string | Optional. When the story begins: an ISO 8601 date and time. Without an offset or `Z` it is the wall clock of `time_zone`; a date alone is that day at midnight. It is where a session's story clock starts when time is simulated (a world with none starts at the moment the session is made). The old export's `starting_time` is read as it is. |
| `rules` | list of strings, or one string | Optional. What is not allowed in this world, as short rules in the author's own words ("There is no magic.", "Guns do not exist."); at most 30, each at most 300 characters, blanks left out. They are free text, not a fixed vocabulary. A session copies them when it starts and the game master is told them every turn: an action of the player's character that breaks one fails, and an out-of-character command that breaks one is refused. The player may add rules of their own in the chat's settings. |
| `time_zone` | string | Optional. An IANA time zone name (`Europe/London`, `Asia/Shanghai`, `UTC`) the story's time is read in. Default UTC. A session whose time follows the real clock uses the zone of the computer unless its settings choose one. |
| `author` | object | `name` (required string) and `url` (string). Embedded here instead of a separate `author.json`. |
| `metadata.tags` | array of strings | |
| `cover_media_id` | string | Optional. Looked up in `media/manifest.jsonl` (`id` and `file`); the file must be a png, jpg, jpeg, webp, gif or avif inside the world folder. Without a cover the card shows a placeholder. |
| `narration_voice` | string | Optional provider voice id for narrated text. It is copied into a new session and can then be changed for that session. Voice ids may be entered manually when a provider cannot list them. |

## `characters/<folder>/character.json`

One file per character. A character is split into a **definition**, which does
not change during play, and a **start** block, the character's state when the
story begins. Think of the start block as a save made just after the story
started: a player jumps in at that point. The state that evolves during play is
tracked per session and is not part of the world.

### Definition

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | folder name | Provisional id, unique within the world, up to 100 characters. Used only to link files of the exported world. An importer assigns the real ids. |
| `name` | string | | Required. |
| `aliases` | array of strings | `[]` | Nicknames and other names the character answers to. Titles are not listed; they follow from what the character does. |
| `age` | string or number | unset | Free text is fine: `"looks thirty"`. |
| `gender` | string | unset | |
| `pronouns` | string | unset | For example `"she/her"`. May differ from `gender`. |
| `kind` | `person` \| `group` | `person` | A group is a crowd or organisation acting as one participant. |
| `tier` | `principal` \| `supporting` \| `background` | `principal` | Principals act on their own, supporting characters act when a scene involves them, background characters only react as the world changes. |
| `role` | `playable` \| `npc` | `npc` | A world may offer several playable characters; the player chooses one when starting a session. A playable character must be a person and not a background character. |
| `summary` | string | | One or two sentences for lists and previews. |
| `personality` | string | | |
| `background` | string | | |
| `appearance` | string | | |
| `speech.style` | string | | How the character talks: register, rhythm, verbal habits. |
| `speech.examples` | array of strings | `[]` | Sample lines. |
| `voice` | string | unset | Provider voice id used for this character's utterances. It may be selected from provider discovery or entered manually. |
| `visual_identity` | object | unset | Stable provider-neutral appearance used by reference and scene images: required `description`, optional `tags`, `negative_tags`, and globally unique `global_id`. Do not put expression, current clothing, activity or surroundings here. See [Image system](./image-system). |

### `start`

| Field | Type | Notes |
|---|---|---|
| `public_state` | string | What anyone present can see or work out. |
| `inner_state` | string | What the character thinks and feels; nobody else can see it. |
| `activity` | string | What the character is concretely doing, which may differ from how it looks. For example the activity is "looking for the key" while the public state is "trying to get through the vault door". |
| `emotion.baseline` | object | Slow-moving temperament: `valence`, `arousal`, `dominance`, each from -1 to 1 (default 0). Required when `emotion` is given. |
| `emotion.immediate` | object | How the character feels right now, same shape; the baseline when not given. |
| `location` | string | Where the character starts: the `id` of a place of the world (see below). Without it the character is nowhere until the story puts it somewhere. |
| `position` | string | Where in that place, in words ("at the bar", "by the door"). Needs `location`. |
| `feature` | string | The `id` of a feature of that place the character is at. Needs `location`. |
| `intents` | array | What drives the character, below. |

### `relationships`

An optional array on the character: how this character stands towards others of the world (`to` is
their `id`). Each is a small profile, from this character's own point of view; the other direction is its own
profile in the other character's file (a profile one way only is allowed: the other may not know).

| Field | Type | Default | Notes |
|---|---|---|---|
| `to` | string | | Required: the `id` of another character of the world. One profile per character. |
| `label` | string | | Required: what the other is to this character in a word or two ("sister", "rival", "landlord"). |
| `summary` | string | | The relationship in a sentence or two: how it came about, what it is like now. |
| `familiarity` | number | 0 | 0 (a stranger) to 1 (intimately). |
| `trust` | number | 0 | -1 (distrusts) to 1 (trusts completely). |
| `affinity` | number | 0 | -1 (dislikes) to 1 (is fond of). |
| `tension` | number | 0 | 0 to 1: how strained it is now. |

At most 60 per character. A character is told how it stands towards those it is with. The profiles change in
play, and characters made up in play get their own.

No relationship profile means this character does not know the other character. A profile may be neutral with familiarity 0 when the character merely knows the other exists. Meeting someone creates a neutral profile during play; later events may give it a more specific label and impression.

### `knowledge`

An optional object on the character records the non-character entities it knows when the story starts. Knowledge is closed-world: an entity not listed here, not visible at the starting place, and not learned during play is unknown to that character. It means only that the character can identify the entity; it does not reveal its current location, holder, contents, occupants or state.

| Field | Type | Default | Notes |
|---|---|---|---|
| `locations` | list of strings | `[]` | Place ids the character knows exist. Its starting place and the visible destinations from it are learned automatically. |
| `items` | list of strings | `[]` | Item ids it knows exist. Visible things at its starting place and things it carries are learned automatically. |
| `exits` | list of objects | `[]` | Directed routes it knows, each `{ "from": "<place id>", "to": "<place id>" }`. The matching authored exit must exist. Visible exits at its starting place are learned automatically. |
| `lore` | list of strings | `[]` | Lore ids the character knows. Only these canonical entries are available to that character's lore lookup. |

Knowledge is not transitively expanded: knowing a place does not reveal its exits or contents, and knowing an item does not reveal where it is. Relationships remain the corresponding character-to-character knowledge edges.

## `factions/<folder>/faction.json`

A faction is a persistent organisation with institutional state and strategy. It is not a scene actor; use a `kind: "group"` character for a patrol, crowd or committee that speaks and acts in a scene.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | folder name | Stable within the world. |
| `name` | string | | Required. |
| `aliases` | array of strings | `[]` | Other names for lookup. |
| `summary` | string | | Short description. |
| `description` | string | | Longer institutional description. |
| `values` | array of strings | `[]` | Principles the organisation claims or follows. |
| `structure` | string | | Its organisation and leadership in prose. |
| `start.public_state` | string | | Its publicly observable institutional condition. |
| `start.inner_state` | string | | Private pressures, disputes or policy; not a collective consciousness. |
| `start.goals` | array | `[]` | Strategic intents in the same format as character intents. They pressure members but do not directly act for them. |
| `members` | array | `[]` | Memberships: `character` (required id), `role`, `rank`, `status` (`active`, `inactive`, `former`), `public` (default true), `commitment` (0–1). A character may appear in any number of factions. |
| `relationships` | array | `[]` | Directional profiles from this faction. `to` is `{ "kind": "character" \| "faction", "id": "..." }`; profile fields are the same as character relationships. |

Membership and awareness are distinct. A membership creates the member's neutral awareness/profile of its faction, but whether outsiders know the membership belongs to perception and memory. Faction relationships are directional: an organisation's view of a person is independent of that person's view of it, and two factions may understand the same alliance differently.

### Intents

| Field | Type | Default |
|---|---|---|
| `name` | string | Required. |
| `description` | string | |
| `type` | `need` \| `obligation` \| `quest` \| `agenda` \| `aspiration` \| `relationship` \| `habit` \| `reaction` | `agenda` |
| `status` | `active` \| `paused` \| `completed` \| `failed` \| `abandoned` | `active` |
| `horizon` | `immediate` \| `short` \| `day` \| `long` \| `open_ended` | `short` |
| `priority`, `urgency` | number from 0 to 1 | `0.5` |
| `plan` | array of strings | `[]` |
| `open_threads` | array of strings | `[]` |
| `constraints` | array of strings | `[]` |
| `deadline` | ISO 8601 date or date-time | unset |

### Example

```json
{
  "id": "arthur-moore",
  "name": "Arthur Moore",
  "age": 37,
  "gender": "male",
  "pronouns": "he/him",
  "role": "playable",
  "summary": "Independent investigator.",
  "personality": "Competent and observant. His politeness conceals deep distrust.",
  "appearance": "A neatly kept man with watchful eyes.",
  "start": {
    "public_state": "Arriving in town during the festival.",
    "inner_state": "Wondering who hired him.",
    "activity": "questioning the innkeeper at the bar",
    "emotion": { "baseline": { "arousal": 0.2, "dominance": 0.3 } },
    "intents": [{
      "type": "quest",
      "name": "Investigate the director's disappearance",
      "priority": 0.9,
      "plan": ["Question the innkeeper about Room 7"]
    }]
  }
}
```

### `variables.json` and initial values

What the world tracks beyond what every story does (the feelings of characters: `valence`, `arousal`, `dominance`, built in). An optional list at the world's
root; a world with none tracks only the built-in ones. Each entry:

| Field | Type | Default | Notes |
|---|---|---|---|
| `key` | string | | Required. Lowercase letters, digits, `_`, starting with a letter. |
| `name`, `description` | string | | `name` required; the description is for whoever reads and changes it. |
| `kind` | `number`, `flag`, `choice` | `number` | |
| `subject` | `character`, `item`, `location`, `world` | `character` | What each value is about; `world` has one value for the whole story. |
| `only` | list of ids | all | Limit it to these characters, items or places (their ids in the world). |
| `min`, `max`, `integer` | | | Bounds of a number; whole numbers only. |
| `options` | list of words | | For a choice: 2 to 12. |
| `default` | value | 0, false, the first option | What it is until something changes it. |
| `baseline` | boolean | false | Whether each value has a temperament beside the current one (feelings do). |
| `visibility` | `public`, `private`, `hidden` | `public` | Who can tell the value: anyone present; only the character it belongs to (and the game master); only the game master and the keeper. Only what belongs to a character can be private. |
| `bands` | `[{ "up_to": n, "label": "..." }]` | | Words for ranges of a number, lowest first. |
| `always` | boolean | false | Told always, not only once it differs from its default. |

A built-in variable can be redescribed here (name, description, bands, visibility) but keeps what it is. At most 60 variables. Initial values go in a `variables`
object by variable key: in `character.json`, `item.json`, `location.json` and `world.json` (for variables of the whole story); `start.emotion` in a character file sets the
baseline and current value of the three feelings.

### `routine` (in `character.json`)

The recurring day of a character: a list of windows, in the order they apply (the first that fits the moment applies). Optional; a character with none
stays where it is, and, if it matters and was away while time passed, the world author gives it one in play.

| Field | Type | Default | Notes |
|---|---|---|---|
| `days` | list of `mon` … `sun` | every day | A window past midnight belongs to the day it starts on. |
| `from`, `to` | `HH:MM` | | Required. `to` before `from` ends the next day (`22:00` to `06:00`); equal is empty. |
| `activity` | string | | Required. What it is doing: `minds the shop`. |
| `location`, `feature`, `position` | string | | The id of a place of the world, a feature of it, and where in it. `feature` needs `location`. |
| `interruptible` | boolean | true | Whether it would drop this for something that comes up. |

At most 24 windows. Times are read in the zone of the chat.

## `locations/<folder>/location.json`

A world may have places. Each is a subfolder of `locations/` holding a `location.json`
(the folder also keeps its media later). A world with no `locations/` folder has no places and plays
as before: everyone is together.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | folder name | Unique in the world; how `parent`, `exits` and a character's `start.location` name it. |
| `name` | string | | Required. |
| `description` | string | | What it is like. Told to everyone in it. |
| `visual_identity` | object | unset | Stable visual facts of the place; same shape and rules as for a character. |
| `parent` | string | none | The `id` of the place this one is in (a room in a building, a building in a district). Containment only: it says what is inside what, not how to get from one place to another. No circles. |
| `features` | array | `[]` | Named things in the place that a story can point at: `{ "id", "name", "description" }`. At most 30 per place; at most 12 are told at a time. `id` is letters, digits, `-` or `_`, unique within the place. |
| `exits` | array | `[]` | The ways out of this place, at most 30. |

Each exit: `to` (the `id` of the place it leads to, required), `description` (what it looks like from here),
`one_way` (default false: the way back is made too, with `back_description` or the same description),
`travel_time_seconds` (whole seconds; authored data, nothing enforces it yet), `state` (`open`, `locked` or
`blocked`; default `open`), `note` (why it is locked or blocked) and `opened_by` (the ids of the items that open it when it is
locked; applies to both directions of the way). Characters go from place
to place only over open exits (through other places if the way is longer); the game master can carry a
character past them when the story itself does (carried off, teleported). The state of an exit changes in
play: a door is unlocked, a passage collapses.

When a session starts the places are copied into it, so the story can make up places of its own (a hidden
passage) and change them without touching the world's files. At most 500 places per world.

```json
{
  "id": "iron-stag-bar",
  "name": "Iron Stag Inn - Bar",
  "description": "The busy ground-floor bar of the inn.",
  "parent": "blackwater-ridge",
  "features": [{ "id": "notice-board", "name": "Notice Board", "description": "Festival notices." }],
  "exits": [
    { "to": "town-square", "description": "the inn door", "travel_time_seconds": 60 },
    { "to": "iron-stag-room-7", "description": "a narrow stair up", "travel_time_seconds": 30 }
  ]
}
```

## `items/<folder>/item.json`

Everything physical that can be moved, held, worn, opened or used is one kind of thing: an **item**. What it can do is what it
has: a slot it is worn in (so it is equipment), a container it holds things in, a quantity when there are several alike.
Scenery that cannot be moved (a desk, a window) is a **feature** of its place instead. A world with no `items/` folder has no
items.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | folder name | Unique in the world. |
| `name` | string | | Required. |
| `description` | string | | |
| `visual_identity` | object | unset | Stable visual facts of the item; same shape and rules as for a character. |
| `quantity` | whole number | 1 | For things that come in numbers (coins, arrows). |
| `unique` | boolean | false | Only one exists in the story: never split or merged. A unique item has no quantity. |
| `quality` | string | | Its condition in words ("worn", "freshly oiled"). |
| `notable` | boolean | false | Matters to the story: told first and never left out of a short list. |
| `hidden` | boolean | false | Seen by nobody until found. |
| `wearable` | string | | The id of the slot it is worn in (below). |
| `container` | object | | Makes it something that holds things: `state` (`open`, `closed` or `locked`; default `closed`) and `opened_by` (ids of the items that open it). At most 10 openers. |
| `owner` | string | | The id of the character it belongs to: not the same as who has it. |

It starts in **exactly one** of: `location` (a place id, with optional `position` and `feature`), `held_by` (a character id),
`worn_by` (a character id, with optional `position`; needs `wearable`) or `inside` (the id of a container item, with optional
`position`). `feature` needs `location`. At most 2000 items per world.

`items/slots.json` (optional) adds to or changes the **slots**, the places on the body something can be worn: a list of
`{ "id": "quiver", "name": "quiver", "capacity": 1 }`. The usual ones exist (head, face, neck, torso 2, back, waist, hands, wrists 2,
fingers 4, legs, feet), so a world only lists what it needs that is different (a tail, a quiver, wings). Slots are data: the story can
add one when something established cannot be worn in any existing one.

```json
{
  "id": "brass-key",
  "name": "Brass key",
  "description": "Opens the oak chest.",
  "unique": true,
  "notable": true,
  "held_by": "clara-whitlock"
}
```

## Lore

Canonical background knowledge is split into independently addressable files at `lore/<id>/lore.json`. Keeping entries small lets the game master retrieve only what a scene needs, and lets a character know one fact without receiving the rest of the world's private canon.

```json
{
  "id": "founding-of-blackwater",
  "title": "The founding of Blackwater",
  "kind": "history",
  "summary": "Blackwater grew around the river crossing in 1764.",
  "body": "The first permanent settlement...",
  "subjects": [
    { "kind": "location", "id": "blackwater" },
    { "kind": "faction", "id": "town-council" }
  ],
  "related": ["old-ferry-custom"],
  "sources": ["Blackwater parish register, volume I"],
  "starts_at": "1764-01-01",
  "ends_at": "1810-12-31"
}
```

`kind` is one of `history`, `culture`, `religion`, `politics`, `geography`, `science`, `custom`, `legend` or `other`. Subjects may name a `character`, `faction`, `location`, `item` or another `lore` entry. `related` links other lore without implying equivalence. Dates are optional ISO dates or date-times and describe when the fact applies, not when it was authored. `sources` records provenance for authors and the editor; it is not an epistemic truth flag.

A character knows no lore by default. Add lore ids to `knowledge.lore` in its `character.json` to expose those entries to that character's agent. The game master can search all canonical lore; a character's lore tool only returns entries connected by these explicit knowledge edges.

## `plots.json`

Optional list of open-ended dramatic scaffolds. A plot describes possibilities, never scenes that must happen. Definitions are copied into session metadata at start; offered, rejected and completed developments then belong to that session.

```json
[
  {
    "id": "missing-keeper",
    "name": "The Missing Keeper",
    "premise": "The lighthouse keeper vanished after seeing a secret landing.",
    "themes": ["secrecy", "duty"],
    "participants": ["lighthouse", "harbour-watch"],
    "hooks": [
      {
        "id": "failed-lamp",
        "text": "The lighthouse lamp fails during bad weather.",
        "guidance": "Let the failed light become naturally perceptible.",
        "avoid": ["Do not reveal why it failed", "Do not make the player investigate"]
      }
    ],
    "developments": [
      {
        "id": "coded-signal",
        "text": "A coded signal can be noticed.",
        "mode": "reminder",
        "prerequisites": ["failed-lamp"],
        "guidance": "A repeating light appears from the headland.",
        "avoid": ["Do not establish who sent it"]
      }
    ],
    "stakes": ["Ships may founder", "The witness may be found first"],
    "resolutions": ["Rescue the keeper", "Expose the landing", "Bargain", "Walk away"],
    "start": "available",
    "pacing": { "quiet_turns": 3, "cooldown_turns": 4, "cooldown_days": 1 }
  }
]
```

`start` is `dormant`, `available`, `engaged`, `cooling`, `resolved` or `abandoned`. Development `mode` is `opportunity`, `reminder`, `character`, `consequence`, `escalation` or `breathing_room`. Prerequisites name other hook/development ids in the same plot. Cooldowns are lower bounds: the director may remain silent longer, and a recommendation never executes or completes anything.

When a session has no scaffold and has remained quiet, the game master may ask the plot-author child for one. It must reuse session state and produces the same structure in session metadata; none of its proposals have happened merely because it authored them.

## `triggers.json`

What the world does by itself when something comes true: a deadline passes, someone arrives, a trap springs. An optional list at the world's root (nothing when
there is none); at most 200 for a story. A trigger names characters, places, items and variables by the ids used elsewhere in the world, and the start is refused,
with every problem and where it is, when it names one the world does not have.

```json
[
  {
    "key": "blackout",
    "name": "The lights go out",
    "when": { "type": "all", "conditions": [
      { "type": "time", "from": "1912-10-05T21:00" },
      { "type": "place", "character": "arthur-moore", "location": "bar" }
    ] },
    "effects": [
      { "type": "edit", "edit": {
        "events": [{ "text": "The lights go out in the bar.", "location": "bar", "tags": ["blackout"], "importance": 3 }],
        "exit_changes": [{ "from": "bar", "to": "cellar", "state": "open" }]
      } },
      { "type": "beat", "text": "A scream comes from upstairs as the lamps die." },
      { "type": "cue", "characters": ["clara-whitlock"], "text": "You smell gas." }
    ],
    "announce": { "audience": "everyone", "text": "The mayor has promised the town lights tonight.", "at": "1912-10-05T21:00" },
    "repeat": false,
    "priority": 0
  }
]
```

- **`key`, `name`**: the key is lowercase letters, digits, hyphens and underscores (at most 64); the name is a label for the author and is never shown to any model.
- **`when`** is decided in code from what the story has recorded; no model judges it. Times are local to the story's zone (`YYYY-MM-DDTHH:MM`, and `HH:MM` for a time of day).
  - `{"type": "time", "from"?, "to"?, "window"?: {"from": "22:00", "to": "06:00"}, "days"?: ["fri"]}`: true from `from` on, until `to`; or while the time of day is in the window (past midnight when it ends before it starts), on the days given.
  - `{"type": "place", "character", "location", "feature"?}`: the character is there.
  - `{"type": "variable", "variable", "subject"?, "op": "eq|ne|lt|le|gt|ge", "value"}`: `subject` is the id of the character, item or place it is about, none for a world variable; flags and choices compare with `eq` and `ne` only.
  - `{"type": "item", "item", "held_by"?}` or `{"type": "item", "item", "at"?}` (exactly one): held (or worn) by a character, or lying in a place, also inside something there.
  - `{"type": "event", "tag"}`: an event with this tag was recorded. `{"type": "fired", "trigger"}`: another trigger has fired (this is how a sequence is built). `{"type": "judged", "text"}`: a statement about the story (at most 300 characters, such as "the mayor has lost the town's trust") that a model judges after each turn, for what no record can say; it is false until judged, at most `triggers.judgedPerTurn` statements are judged per turn in one request, and the trigger fires from the verdict at the next look. Combine it with `all` and `not` like any other condition.
  - `{"type": "all"|"any", "conditions": [...]}` and `{"type": "not", "condition"}`, nested at most 4 deep and 24 parts in all.
- **`effects`** (one to six): an `edit` is a change of the records in the format of the record keeper's `edit_records` (events, variable changes, exit and item changes, moves, goals and
  engagements), applied together or not at all; an event without `turn`, `round`, `importance`, `tags` or `involves` gets the moment it fired, importance 3 and none, and one with a
  `location` and no `perceived_by` is seen by the characters there. A `beat` is something the game master is told to weave into the story (it says it did with the beat's id; it is let go after
  `triggers.beatTurns` turns). A `cue` is something its audience notices, said to each of them the next time they act: `"characters": [ids]`, or `"audience"`: `"everyone"` (every character that can act), `{"characters": [ids]}`, or `{"place": id}` (whoever is there when it fires). In an `edit` effect, an event may say `"perceived_by": "everyone"`: every character took it in, as told (it is then in their memories).
- **Written when told.** A beat or cue is not necessarily told when its trigger fires: a cue waits for its characters to act, a beat for the game master's next look, up to `triggers.cueTurns` and `triggers.beatTurns` turns. The note keeps the words as written, and they are made at the moment they are told, from the story as it stands then:
  - `text` may name things by `{kind:key}`, filled in with the current name or state: `{character:key}`, `{place:key}`, `{item:key}` (names, so a renamed thing is renamed in the words), `{where:character}` (the name of the place a character is in), `{holder:item}` (who holds an item, or the place it lies in), `{value:variable}` and `{value:variable:subject}` (the value in words, with its band), `{time}` (`19:30`). Anything between braces that is not one of these kinds is refused when the file is read; other braces are plain text.
  - `while` is a condition in the grammar of `when` (nothing a model judges) that must still hold when the note is told. When it does not, the note is withdrawn instead (its status is `lapsed` and the reason is kept, shown in the interventions list of the chat settings as *withdrawn*). The same happens when the words name something that is not there (a character that is nowhere, an item no one has): they are not written from a guess.
  - In a cue, `"@self"` stands for the character it is said to, in `while` (`{"type": "place", "character": "@self", "location": "bar"}`) and in the words (`{where:@self}`), so that each of an audience is told, or not, by where it is and what it has. A beat has no `@self`. An `edit` effect has neither.
  The beat or cue is also written (or withdrawn) at the moment of firing, for the report to the game master.
- **`announce`** separates *scheduled and known* from *secret*. Without it a trigger is a secret until it fires (a war that breaks out). With it, what is known beforehand is told while the trigger has not fired: `audience` (as for a cue), `text` (the public side only, never what the effects do), `from` (the local time it becomes known; known from the start when left out: a final exam is known months ahead, a surprise inspection is announced a day before) and `at` (when it is to happen, as told; taken from the time the condition waits for when that is a plain `time` `from`, also inside `all`). The game master sees every announcement in the scene with who knows of it; a character is told, in its brief, the three soonest that it is among the audience of (a place audience counts those there now). It stops being told when the trigger fires, fails or expires; the event itself still happens by itself.
- **When it fires**: when the condition turns true, not while it stays true; at once if it is already true the first time it is looked at. It is looked at at the start of every turn and after
  every round and every skip in time, by `priority` (higher first), at most `triggers.maxFires` per look. By default it fires once. `"repeat": true` lets it fire again after the condition went
  false and true again, and `cooldown_seconds` is the least story time between two firings. `chance` (0 to 1) is rolled in code from the trigger, the turn and the round, so it comes out the same
  when replayed; a failed roll uses that rise up. `expires` (a local time) ends it. An effect that cannot be applied marks the trigger failed with the reason; it is not tried again.

## Player avatars

Characters that belong to no world live in `<root>/avatars/characters/<key>/character.json`, in the format above, with their media beside them (`<root>/avatars/images/…`). They are edited on the Avatars tab with the same editor as a world's characters (the world editor serves them as the world `@avatars`). An avatar is made with a name and is playable.

An avatar becomes a character of a world in two ways: **added to the world** (Worlds page, world editor, *Add avatars*: a copy is written into the world's `characters/` with its portrait), or **brought into one session** (the start dialog; the world's files are not changed, and the player may take it). Either way it is adapted the same way: it is playable, its id is made unique in the world, it starts at the place where the world's playable characters start (or the first place), its relationships are kept for characters that are there, and what points into a world it was not made for (knowledge, daily routine, variables) is dropped.

## `prompts/<language>/<group>/<name>.md`

Optional. Instructions for the models that replace the shipped ones for sessions of this world (for example how the narration is written). The ids and variables are defined by the [prompt system specification](./prompt-system); a file for a prompt that does not exist, an empty one, or one using a variable the prompt is not given refuses the start of a session. They are copied into the session when it starts.

## Not part of the format yet


Authored memories and suspicions are not part of the format yet.
