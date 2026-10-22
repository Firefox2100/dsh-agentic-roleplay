---
title: What the code enforces and what it only advises
description: Which rules of a story are checked by code, which are left to the models, and where the line sits.
---

A story is run by models, so some rules are held by code and some are only asked for in a
prompt. This page lists both, so a world author or a maintainer knows what can be relied on.
"Enforced" means the code refuses or corrects the result regardless of what a model says.
"Advised" means a prompt or a brief asks for it and nothing checks it.

## Enforced in code

| Area | What is held |
|---|---|
| Output | Every utterance a character gave appears exactly once in the narration, none is invented, and they come in the order of their rounds. The third failed attempt is corrected by code and marked repaired. |
| Language | Narration and a character's answer written in the other script than the chat's language, and lowercase English words left in Chinese text, are refused with the language named. Only English and Chinese are told apart; very short texts pass. |
| Knowledge | A character is shown only what it knows: a missing edge means it does not know the entity. Intended movement goes only through known destinations and known directed exits. |
| Movement | Locked and blocked exits refuse a move and name the blocking exit. Only the story's own decree (`ignore_exits`) goes through them. |
| Things | A thing must be reachable (not hidden, closed or locked), a key must be in hand, a wearable fits its own slot and the slot's capacity, and a container cannot hold itself. |
| Dice | The code rolls and reads the band; the game master never interprets a number. When the judgement flags an attempt as uncertain and the agent has dice, activation is refused until a roll exists, and an outcome for a rolled character must cite that roll. |
| Memory | A sealed event cannot be edited or removed. A record edit is applied whole or not at all. With `memory.verify` the keeper cannot finish before it has read back its last edit. |
| Turn | One turn at a time per chat; at most `maxRounds` rounds and `maxCharacters` characters per round; the output is delivered through `narrate`, and the turn ends there. |
| Input | The game master judges ordinary input with `judge_action` before anything else. Refusing it is a failed round for the player's character, never a skipped turn. |
| Authoring | At most `authoring.perTurn` made-up things per turn, a name or alias already taken is refused, a made-up place must be connected and a made-up character placed. Only the world author can make things. |
| Tools | Optional tools and tools of other plugins are off unless switched on for that kind of agent. A helper's tools are withdrawn when its budget is used, and a repeated failed call is refused. |
| Files | A world, a preset, a pack and a start request are checked against their formats before anything is created, with every problem reported. Interface packs run in a sandbox and see only the player's view. |
| Time | Simulated time moves only by rounds and by `advance_time`; real time follows the wall clock and cannot be skipped. A round takes at least the player's journey. |

## Advised only

| Area | What is left to the model |
|---|---|
| World rules | The free-text `rules` of a world are judged by the game master through `judge_action`. Code makes sure the judgement happens first; it does not decide the verdict. |
| Relationships | Familiarity, trust, affinity and tension are shown in a brief. No code uses the numbers. |
| Who perceives | The briefs show who was where; which characters perceived an event is decided by the record keeper when it writes. |
| Misperception | Whether a character misremembers is decided by the writer at write time, told the chat's `flaky` setting. |
| Commitments | Whether an engagement was kept is never judged in code; the character and the keeper decide. |
| Beats | A beat from a trigger is a soft suggestion to the game master and lapses if not taken up. A cue is told to a character, who may ignore it. |
| Travel | Exit travel time counts for the player's journey and for routine moves. Other characters' moves are not delayed by it. |
| Plausibility | There is no weight or capacity for carried things; the model reasons about what is plausible. |
| Character thought | The `thought` field is advertised as required but not enforced, and its order in a tool schema is only partly respected by the backend. |
| Suggestions | They are checked for count, length and repeats, not for sense. When the suggester fails, lines made from the story's own data (someone present, an open way, a visible thing) are shown instead. |
| Imported text | Input and imports are trusted; nothing guards against instructions hidden in a card or a preset. |
