---
name: world-commands
description: The commands.json format: the world's own slash commands, the flag each raises, and how triggers use it.
when_to_use: Before you replace the world's commands with write_world_file (kind commands), or when the player should be able to start something with a slash word.
---

# Slash commands (`write_world_file`, kind `commands`)

`commands.json` is an object with a `commands` list: `{ "commands": [...] }`. A command is a word the player types after a slash. Using it raises a hidden flag variable `command_<key>` for that turn only; a trigger waiting on the flag then does something (asks the world author for a person, sets a variable, gives the game master a beat).

## A command

| Field | Type | Notes |
| --- | --- | --- |
| `word` | text | Letters, digits or underscores, at most 30. The game reserves `ooc`, `ask`, `roll`, `wait` and `dream`. |
| `key` | text | Required when the word is not lowercase ASCII: lowercase ASCII letters, digits, `_`, starting with a letter. The flag is `command_<key>`; for a plain lowercase word the key is the word. |
| `description` | text | Shown to the game master when the command is used: what the player means by it. |

At most 20 commands. Do not declare the flag yourself in `variables.json`: a variable of the same name is refused.

## Design notes

- A command does nothing by itself. Pair it with a trigger whose `when` is `{ "type": "variable", "variable": "command_recruit", "op": "eq", "value": true }` and `"repeat": true`.
- Write the description for the game master, not for the player.

## Example

```json
{ "commands": [
  { "word": "recruit", "description": "Bring a new follower into the cult." },
  { "word": "招募", "key": "recruit_zh", "description": "Same, written in Chinese." }
] }
```
