---
name: world-where-things-go
description: Which part of a world holds what: personality, speech, conditional behaviour, secrets, rules, style, state that changes. Load it before deciding where a piece of information belongs.
when_to_use: Before you write anything from a card, a note or the person's description, and whenever you are unsure whether something is a character's trait, a fact of the world, a rule, a style instruction or something that has to happen on a condition.
---

# Where things go in a world

A world is split by **who reads it and when**, not by topic. Putting a thing in the wrong place does not break the world; it makes the story ignore it, repeat it or leak it.

| What you have | Put it in | Why |
| --- | --- | --- |
| Who a character is: temperament, habits, outlook | the character's `personality` | Always in that character's brief. |
| How a character talks | the character's `speech.style` and `speech.examples` | Used when the character writes its lines. |
| A character's past, appearance | `background`, `appearance` | Separate fields serve separate prompts: do not merge them into one biography. |
| What a character is doing now, what they hide | `start.public_state`, `start.activity`, `start.inner_state` | Observable, actual and private are three different things. |
| What a character wants | `start.intents` | Goals the character pursues, not traits. |
| A character's recurring day | `routine` | Windows of the day, with place and sleep. |
| Who knows whom, and how they feel | `relationships` (one direction each) | The reverse direction is its own record. |
| What a character knows exists (places, items, lore) | `knowledge` | A missing entry means the character does not know. |
| A fact of the setting everyone knows | lore with `scope: "everyone"` | Every character can look it up. |
| A fact only some characters know, or a secret | lore with `scope: "listed"` and `known_by` | Only the game master and the named characters see it. |
| Guidance on how one character acts in a particular situation ("when X, she does Y") | lore scoped to that character (`listed`, `known_by` her), titled with the condition; or a trigger with a `cue` for her when the condition can be stated | Lore is looked up when the title bears on the moment, so the title must say when it applies. It is not injected by itself. |
| A situation the engine can check (time, place, a value, an item, an event) that must always have the same effect | a trigger | See `world-triggers`. |
| A change the story must track with a number or a yes/no | a variable | See `world-variables`. Not for prose state. |
| How the whole story is written (tone, tense, perspective) | the world's prompts (`roleplay/style`, `roleplay/character-style`) | Applies to every turn. Not to lore. |
| A rule of the world ("there is no magic") | `rules` in the world's info | Checked on every action. |
| Who is where, who holds what at the start | the entity's own `start` fields | Placement changes in play; the file only holds the beginning. |

## What does not belong

- Instructions to the AI inside lore. Lore holds facts. Writing instructions go to prompts; world rules go to `rules`.
- Behaviour guidance for several characters in one lore entry. Split it by person so each is known only by the character it concerns.
- Counters or flags written as prose. If something must be tested, make it a variable.
- Changing facts (where something is, who holds it) in knowledge edges or lore. Those are state.
- Decorative scenery as items or features. Put it in a place's description.

## Order of work

Create the places before the characters that start in them, and the items after both. A character that is somewhere in the story needs `start.location`, the key of an existing place. Keys are stable ids and become folder names.
