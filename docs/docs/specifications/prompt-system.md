---
title: Prompt system specification
description: Prompt materialisation, overrides, variables, validation, language, and runtime boundaries.
---

Every instruction a model is given by this plugin is a file, so that it can be read, changed or replaced without touching the code. They are Markdown files whose whole content is the prompt.

## Where they are

```text
<roleplay root>/prompts/<language>/<group>/<name>.md
```

The package ships the originals in `prompts/<language>/` (English and Chinese). The first time a prompt is needed, and once at start, every prompt that is not in the roleplay root is copied there from the package. A file the person edited is used as it is and never overwritten. **Deleting a file restores it**: the next use copies the original again. A file that is empty is refused with the path (delete it to restore the original).

| Group | What it holds |
|---|---|
| `roleplay/` | the game master's instructions (`game-master`, `persona`), the character's rules (`character-rules`, `character-lookup`, `character-decide`), the record keeper, the chronicler and its three tasks, the suggestion writer, the image author, the plot author, and the short notices added to a scene (`rules`, `plot-hint`, `ooc-command`, `ooc-empty`, `input-refused`) |
| `world/` | the world authoring assistant (`persona`, `procedure`, `welcome`) and the world author that makes up and fits in characters, places and things (`author`, `consolidate`) |
| `import/` | importing a character card: the classifier, the roster, one prompt per kind of thing written (`character`, `place`, `faction`, `thing`, `lore`) with their shared `common-rules`, the world's description and tags, and the texts that steer the authoring chat through the three steps |

## Prompts of a session and of a world

```text
<session folder>/prompts/<language>/<group>/<name>.md
<world folder>/prompts/<language>/<group>/<name>.md
```

A session may carry any of the prompts, in the same structure, and uses its file instead of the one in the root; a prompt it does not carry (or one in another language) comes from the root. Nothing is copied into a session automatically, so editing the root still reaches every prompt a session has not overridden. A branch keeps the prompts of the session it was cut from.

A world may carry prompts the same way. When a session starts, they are copied into its folder. The start is refused (422, with each file) when a file is not a prompt the package has, is in a folder that is not a language, is empty, or uses a `${name}` the original is not given.

Prose and rules. `roleplay/persona`, `roleplay/style` and `roleplay/character-style` set who the models are and how the story is written (the game master's persona holds `${style}`; each character's persona carries its style). Every other prompt holds rules of the game or the tools' contracts.

The world authoring chat edits a world's prompts with `list_world_prompts`, `read_world_prompt`, `write_world_prompt` and `delete_world_prompt` (a delete moves the file to `.trash/prompts/`). Writing and deleting need the person's approval like any other change to the world files, and a write is checked as session start checks it. In the turn that has just imported a card, which runs without asking, the prose prompts can be written without approval and the rules prompts are refused outright.

Optional parts: the game master's prompt holds `${preview}` on a line of its own, which is the text of `roleplay/preview` when the chat's `preview.enabled` is on and nothing when it is off (a line that holds only a variable given as empty text is dropped). A chat that shows no preview also has no `preview_scene` tool. In the same way `${dice}` is the text of `roleplay/dice` (when to roll, how the result is read, that it stands, and the world's checks listed from the story) while the game master has a dice tool switched on, and nothing when it has none.

## Presets

A preset is a reusable set of writing instructions, kept in the library under `<roleplay root>/presets/<name>/`:

```text
preset.json                                  { "title": "...", "description": "...", "sampling": { "master": 0.8, "characters": 0.9 } }
prompts/<language>/roleplay/style.md         the same layout as the prompts of a world
```

A preset carries only the prose prompts (`roleplay/persona`, `roleplay/style`, `roleplay/character-style`), checked as a world's prompts are (a prompt the package has, not empty, only its own `${name}` variables). The rules of the game stay with the world. `sampling` may suggest the creative temperatures of the game master and the characters (0 to 2); the helper agents' low temperatures are not a preset's to change. A preset has prompts only for the languages it has folders for: another language uses the root's prompts, not English. A preset with a problem is listed with it and cannot be used.

A preset is **copied** into the story when it starts, so later edits to the library never change a story in progress, and a branch keeps its story's preset. The files are written in this order, later ones replacing earlier ones:

1. the root's prompts (nothing is copied; this is the default);
2. the preset the world suggests (`preset` in `world.json`);
3. the world's own `prompts/`;
4. the preset chosen in the start dialog (the request's `preset`; `none` means no preset even when the world suggests one).

So a choice made at the start outranks the world's own prompts, and the world's suggestion is below them. Choosing a preset that cannot be used refuses the start. A suggested preset that cannot be used (the world comes from someone whose library differs) is told to the player on the story's first card and the story is told in the default style. The preset's temperatures fill only the settings the start request did not give.

The story records which preset it came from and what each copied file held (`preset.json` beside the story's database). The chat settings show whether the story still matches the library: *current*, *changed* in the library, *edited* in the story, or *missing* from the library. The person can switch to another preset, re-apply the library's version, or take the preset out. The replaced copies are kept in the story's `.trash/prompts/`. Only the files that came from the preset are touched, and prompts the world carried that a preset replaced are not brought back. Switching does not change the story's temperatures.

Presets are made on the **Presets** page (a copy of the shipped prose prompts to edit, an import of a SillyTavern preset, or the **Save as preset** control on a world editor's Prompts page), by writing the folder by hand, or by saving a world's prose prompts (`POST /roleplay-api/presets` with `name` and `fromWorld`; without `fromWorld` it starts from the shipped prompts). `GET /roleplay-api/presets` lists them; `GET`/`PUT`/`DELETE /roleplay-api/presets/item?name=` read, describe (`title`, `description`, `sampling`) and remove one (removal moves it to `<root>/.trash/presets/`); `PUT`/`DELETE /roleplay-api/presets/prompt?name=&language=&id=` write or remove one prompt; `GET /roleplay-api/sessions/preset?id=` is a story's status and `POST /roleplay-api/sessions/preset?id=` with a `name` switches (without one, takes the preset out).

**Authoring chat.** `POST /roleplay-api/presets/authoring?name=` creates or reopens the dedicated chat `preset-author-<encoded name>` in a *Preset Authoring* project at `<root>/presets`, under the `preset-authoring` agent preset (`@dsh-agentic-roleplay/core/preset-authoring`, declared by the bundle). Its tools reach only the preset the chat is about: `read_preset_info`, `list_preset_prompts`, `read_preset_prompt` (a prompt the preset does not carry reads as the shipped text), `write_preset_prompt`, `delete_preset_prompt`, `write_preset_info` and `import_narration_preset`. Every write asks the person first; the import asks only when the preset already carries prompts. Prompts are written with the checks of a world's prompts and limited to the three prose prompts.

**Importing a SillyTavern preset.** `POST /roleplay-api/presets/import?name=&language=` (body: the file) reserves an empty library entry, keeps the file in its `.import/preset.json`, opens the authoring chat and tells it to call `import_narration_preset`, which runs the same `import/style` job as a card import and writes the prose prompts into every shipped language folder of the preset. Until then the entry is listed with the problem "the preset carries no prompts". A catalogue entry of type `sillytavern/preset` goes through the same path (`POST /roleplay-api/catalogue/convert/preset`), named after the entry's title; an import never replaces an earlier preset.

## Variables

A prompt may contain `${name}`. The code that uses a prompt gives it the values (for example `${name}` of a character, `${max}` for a limit, `${rules}` for a shared block). A variable that is not given a value is an error that names the prompt and the variable, so keep the ones that are in the original. `{{...}}` is not used: DSH's own prompt assembly reads it as one of its variables.

Names of tools, fields and values that the code understands (`activate_characters`, `resolve_round`, `succeeded`, `character`, `[PLAYER]`, ...) must stay as they are in every language; only the prose around them is translated.

## Language

The language is a folder: `en`, `zh`. It is chosen where the work begins:

- a roleplay session: the chat setting **Language of the instructions** (`prompts.language`), set from the interface language when the session is started and editable afterwards;
- the authoring assistant and the card import of a world: the interface language at the moment the person opens the assistant or starts the import (kept per world in `worlds/.authoring/`);
- a language that has no folder in the package falls back to English.

Every prompt may use `${language}`, which is filled with the name of the folder's language (English, 中文). The prompts that tell a model what to write (narration, speech, summaries, beliefs, suggestions) name it, so a story is written in the chat's language even when the world's files are in another; the names and terms of the world stay as its files spell them. A world in another language can be translated (see the editor guide).

A prompt alone does not keep a model in that language when the character sheet and the scene are in another one. So a character's answer, the narration, the beliefs of a reflection pass and the events and perceptions the record keeper writes are also checked by the script they are written in: one in the other language is refused, naming the language, and the model writes it again. A text too short to tell, and a chat in a language other than English or Chinese, are not checked.

A new language is a new folder with the same files; a test keeps the shipped languages the same set of files with the same variables.

## What is not a file

Text that is built from the story's data on every request stays in the code, in a message catalogue: the English text written in the code is its own key (`tr('{name} is in {place}.', { name, place })`) and `dsh-roleplay-model` (`messages.ts`, `messages-zh.ts`) holds the Chinese. The catalogue covers the game master's scene notice (time, days, places, who is where, what is still open, earlier events) and what a character is told (its description, scene, place, things, day, relationships, affiliations, memories with how sure it is of each, and the earlier moves of the scene), the reflection pass's brief and refusals, and the story's dates, times and durations (`1912年9月21日 星期六 19:30`, `3小时12分钟`; with a calendar, the season and the holidays of the day). A text a language lacks is told in English, and a test (`tests/support/messages.spec.ts`) keeps every `tr('...')` call site translated with the same placeholders and every dictionary entry in use. The scene notice also covers what the world did by itself and who went where, and the situations put to characters away from the player (a commitment that fell due, a goal whose time passed). Still English whatever the language, on purpose: the game master's tool results and the working briefs of the keeper, strategist, judge and author, the state tools' views, and descriptions of tools and their parameters. They are protocol, not story: they name tools, fields and ids that must stay as they are, and the story's own words in them (events, names, summaries) are passed through unchanged and written in the chat's language.
