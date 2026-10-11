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

Optional parts: the game master's prompt holds `${preview}` on a line of its own, which is the text of `roleplay/preview` when the chat's `preview.enabled` is on and nothing when it is off (a line that holds only a variable given as empty text is dropped). A chat that shows no preview also has no `preview_scene` tool.

## Variables

A prompt may contain `${name}`. The code that uses a prompt gives it the values (for example `${name}` of a character, `${max}` for a limit, `${rules}` for a shared block). A variable that is not given a value is an error that names the prompt and the variable, so keep the ones that are in the original. `{{...}}` is not used: DSH's own prompt assembly reads it as one of its variables.

Names of tools, fields and values that the code understands (`activate_characters`, `resolve_round`, `succeeded`, `character`, `[PLAYER]`, ...) must stay as they are in every language; only the prose around them is translated.

## Language

The language is a folder: `en`, `zh`. It is chosen where the work begins:

- a roleplay session: the chat setting **Language of the instructions** (`prompts.language`), set from the interface language when the session is started and editable afterwards;
- the authoring assistant and the card import of a world: the interface language at the moment the person opens the assistant or starts the import (kept per world in `worlds/.authoring/`);
- a language that has no folder in the package falls back to English.

A new language is a new folder with the same files; a test keeps the shipped languages the same set of files with the same variables.

## What is not a file

Text that is built from the story's data on every request stays in the code: the scene notice, the briefs of characters, the keeper's brief and the results of tools. They are English whatever the language of the prompts; the instructions around them are the files above. Descriptions of tools and their parameters are English too.
