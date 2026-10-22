---
title: Turn engine specification
description: Exact game-master protocol, tools, stages, timelines, branching, and background work.
---

A roleplay session is played in a DSH chat under the `roleplay` agent preset. The chat's agent is the **game master**; every character that the player does not control is played by a one-shot **character agent** (a DSH sub-agent) that the game master's tools start. The preset mounts `@dsh-agentic-roleplay/core/orchestration`, which adds the game master's tools, hooks and instructions to roleplay chats only.

## The loop

A turn is one player message and the story's answer to it. The answer is **one or more rounds** of characters acting, then the output.

1. The player writes. At the start of the turn the game master is told the state of the scene, and the player's input is checked (`InputValidator`).
2. **`activate_characters`** starts a round: the game master describes the moment objectively. The game master names the characters the moment reaches, from the scene (where each is, what it is doing); a character elsewhere perceives nothing by itself, a round is limited to `maxCharacters` of them, and a character in no place is refused while the world has places. Each is asked, separately and at the same time, what it intends and says. A character answers with a structured `intent` (what it does), an optional `utterance` (what it says aloud, word for word) and a `commitment` (`low`, `medium`, `high`: how hard it will keep trying if the intent does not work out).
3. The game master sees all intents, settles conflicts, and calls **`resolve_round`** with one outcome per character: `result` (`succeeded`, `partial`, `failed`), what concretely happens (`summary`), what others can now observe (`public_state`), and optionally `spoken: false` when the character could not say its utterance.
4. Characters whose intent **failed** and whose commitment is **high** act once more within the round, knowing what everyone just did and what happened to their own intent. The game master resolves that retry the same way. Nothing is retried after that.
5. When no one retries, or after the retry, the round is **recorded**: what the game master decided about each character (activity, public state) is applied at once, and the round is queued durably for the **memory keeper**, which is run only when the game master asks for it with `record_memory` (below). The game master does not wait for it.
6. The game master now **decides**: if the story genuinely flows from what just happened (someone was directly answered, a reaction is natural, something is left hanging that the characters would act on) it calls `activate_characters` again for the next round, asking only the characters the moment calls for. The characters of a later round are told what happened in the earlier rounds of the turn. Otherwise it gives control back to the player. The prompt asks for the first natural point and for as few rounds as the story needs; a hard limit bounds it (below).
7. The game master delivers the **output** with **`narrate`**: ordered segments, each an `utterance` (a character's words) or `narration` (the game master's own text), so narration can come before, between and after the utterances. Every utterance of the accepted actions of **all the rounds** (a retry's replaces the first attempt's) must appear exactly once, exactly as the character gave it and **in the order it was spoken**; the narrator may not change, add, remove or reorder one (lines of the same round may be arranged freely). A character may speak in several rounds. The output is checked: a wrong one is refused with each problem named and the game master delivers it again; after two refusals the checker corrects it itself (restores the words, drops invented or repeated utterances, puts missing ones where their round belongs) and the output is marked `repaired`. Delivering the output ends the turn (the tool concludes it), counts the turn (`turns`, `lastPlayedAt`), and nothing the model adds afterwards escapes the check. The accepted output travels in the text of the `narrate` tool result (`<roleplay-output>` plus JSON: `segments`, `repaired`), which is what the transcript renders from.

Relationships participate in this loop without becoming a second action system. The scene gives the game master a bounded activation priority with reasons (direct mention, presence, tension, distrust or affinity); it is advice only and never overrides reachability. A character receives its directional profiles for people present or explicitly mentioned in the moment, framed as fallible attitudes that shape ambiguity, risk and speech rather than prove another person's motives. A socially charged profile also strengthens a named person as that character's memory cue. The keeper changes only the direction and fields supported by a concrete event and never mirrors the opposite direction automatically. Faction goals and profiles exert pressure under the same rule; they do not command a member.

### Pacing and plots

Worlds may carry optional `plots.json` scaffolds. They are graphs of hooks and developments with prerequisites, several stakes and resolutions, explicit guidance and explicit things not to establish. Session progress is copied into namespaced metadata, separate from canonical world files and from events: a recommendation changes only its own cooldown; a development advances only through `record_plot_progress` after resolved play made it perceptible, the player rejected it, or play settled the whole plot.

At the start of a turn a deterministic director first checks for recent recorded events and immediate open threads. Only after the plot's quiet threshold and both turn/story-time cooldowns does it put one eligible opportunity in the game-master scene. The note is advice, not an event: reachability, character agency, knowledge and ordinary outcome rules still apply. Rejected hooks are not offered again, prerequisites prevent later possibilities appearing early, and nothing requires resolution. If a quiet session has no scaffold, the GM may call `author_plot`; a one-shot child creates one branching scaffold from existing session state, but no part of it has happened and it cannot be used until a later pacing recommendation.

The shared World editor exposes the same canonical definitions for authored worlds and live sessions. World saves atomically replace `plots.json`; session saves replace definitions in metadata while preserving progress for matching plot ids. The session view shows status plus introduced/rejected development ids. Every participant id is validated against the world's characters, factions, places, items and lore at session start and on editor saves.

A turn cannot end before its output is delivered: an `agent/turn-stopping` hook sends the game master back with what is missing (and, between rounds, whether it may run another), at most three times in a row for the same missing thing (the count starts again when the turn has moved on) so a stubborn model cannot trap the chat. This matters after a model request hit its output limit: DSH then ends the turn as soon as nothing steers it on, so every step that follows has to be steered, and `sampling.masterMaxTokens` keeps a looping reasoning from using the whole limit. Characters are never gated, and chats that are not roleplay sessions are untouched.

### The record keeper

What the rounds changed is written into the session database by a child agent of the game master that loops through tools of its own, not by the game master: the records are what the story is remembered from beyond the chat history (see `memory.md`). The child is built by `runChild` (`host/agents/child.ts`; why it goes below the public sub-agent API is in `dsh-api-usage.md`), so the record tools belong to it alone: neither the game master nor the characters have them.

- **The game master decides when.** Memory is not written after every round. A recorded round (with where it happened and who moved where) is queued in the database at once; the game master calls **`record_memory`** (optional `focus`: what is worth keeping) when the story changed phase (a decision, a revelation, a promise, an injury, a changed relationship, a scene or time change), not for small talk or routine movement. A run then writes **every round still waiting**, from this turn and earlier ones, **in parallel** with the game master going on. Runs follow one another. `narrate` checks the output and returns: it does not wait for a run in flight, which goes on behind the story; the next turn waits for it at its first step. Rounds nobody asked to record stay queued, durably. As a backstop, when `memory.backlogRounds` (default 6) rounds are waiting the keeper runs at the end of the turn anyway.
- **Plain events first.** The moment a round is recorded, before any model runs, the engine writes its plain events in the same transaction as the queue entry (`host/orchestration/skeleton.ts`): one event for what each character did (the game master's summary of the outcome) and one for what it said, word for word. Those who stood in the same place perceive them (they hear the words); what the game master said bystanders can see is all they take in of an act. Importance is 2, or 3 when someone or something moved, and there are no tags. The keeper does not write these again: it enriches them with `event_edits` (importance, tags, who is involved, who perceived them and how well) and adds new events only for what no entry covers. A run that fails or is never asked for therefore leaves plainer records, never missing ones, and the draft events are sealed with the run that completes the round.
- **Tags come from the vocabulary in use.** Recall matches tags exactly, so the keeper's brief lists the tags the story already uses with their counts, and its edits are passed through `canonicalTags` (`host/memory/tags.ts`) before they are applied: case, separators, a plural ending or a one-letter slip in a long word map onto the existing tag. A tag that matches nothing stays; there is no other escape to define.
- A failed run leaves its rounds queued and says nothing to the player: nothing reaches the output (the engine only logs it). The next run writes them with its own ("2 rounds are due for records"), and the next turn's first step tries once more when the game master had asked. The chat settings tab shows how many rounds are waiting. A run that failed half way may have written some events; the next brief lists what is already recorded for its rounds so they are continued, not repeated.
- A chat whose keeper fails three runs in a row gives those rounds up: they are marked written without records, the log says which and why, and what the game master decided (activity, public state, places, things) stands. Rounds therefore cannot pile up for ever behind a model that cannot do the job.
- **Events are immutable.** The events a run writes are drafts that it may still correct (`event_edits`, `event_retractions`) while it verifies; when the run completes they are **sealed** and can no longer change or be removed. What a character took in can: `perception_edits` revise a perception (it learned more, or remembers it differently, also of a sealed event) and `perceptions_added` records that a character learned of an earlier event later. Beliefs stay editable.
- **The loop.** Its persona (the rules, the procedure, what to write; the same for every run) starts every request; the prompt holds only what changes: the chat's two settings, the rounds due, the state of the characters, the recent events, the events already recorded for these rounds, the open threads. It has `edit_records` (one call holds states, events with who took each in, beliefs and threads, applied together or refused with every reason, so it corrects and calls again; refused too when it names a round it was not given), `read_records`, `search_events`, `list_threads`, and `submit_result {complete, notes}`.
- **Verification** (`memory.verify`, on by default) is a gate, not a second stage: `submit_result` is refused until it has read the records back (`read_records`) after its last change, compared them with the rounds (an event the rounds do not support, something stated and missing, a duplicate, a perception by someone who could not have perceived it or missing for who acted, a state that is a log or leaks a thought, an unsupported belief, an importance out of proportion) and fixed what it found. When nothing at all is recorded for its rounds it must also have written something before it may say nothing happened. Off, it submits as soon as it has written: two or three model calls instead of four or more. It reports `complete: false` when something is still wrong, which fails the run. At most 60 calls.
- The `Committer` boundary is where to replace or extend it; `writesOutcomes` is the plain default when the keeper is not installed. The game master's activity/public-state decisions are not the keeper's business: the engine applies them when the round is recorded.

### Characters

Each character is a child built the same way, with the persona of that character (its definition and fixed rules) and a prompt of what changes (the situation, who is present, what it remembers, what happened). Its one tool, `recall_my_memories` (setting `memory.lookup`), is created for that character and registered on that child alone, so characters activated at the same time each reach only their own memories; another child asking the same tool gets its own answer. It ends with `submit_result {intent, utterance, commitment}`.

### Keeping the provider's cache

Local providers answer much faster on a prefix they have seen. Every request of a child therefore starts with what never changes, and only the end differs: the persona (fixed rules, the character or the keeper's procedure) and the tool list come first and are the same from run to run (a test asserts it), the prompt is only what changed, and between folds the game master's conversation only grows at its tail.

### The limit of rounds, per chat

Asking the same characters about the same situation twice in one message is refused (`state.asked`, compared without case and punctuation): the game master must say what changed, ask others or deliver. A round that produced nobody does not count.

`maxRounds` (1 to 10, default 3) is the most rounds of characters the game master may run for one player message. It lives in `settings.json` next to the chat's `session.sqlite`: configuration, not story state. It is read at each round, so a change applies at once. Past the limit `activate_characters` is refused with an instruction to deliver, and each recorded round tells the game master how many are left. It is edited in the **Chat settings** tab of the chat (a view tab beside Chat and Trajectory, shown for roleplay chats), through `GET`/`PUT /roleplay-api/sessions/settings?id=`.

## Extension points

`TurnEngine` (`src/host/orchestration/turn-engine.ts`) holds the rules above and knows nothing of DSH. Everything that is expected to change sits behind an interface in `boundaries.ts`, with a default in `defaults.ts`. The `roleplayOrchestration` service holds the active set; another plugin changes behaviour with `ctx.roleplayOrchestration.replace({ ... })`, which applies from the next call and returns a function that restores the previous one.

| Boundary | Decides | Default |
|---|---|---|
| `ActivationPlanner` | which characters are asked to act | everyone the player does not control, or the ones the game master names |
| `CharacterContextProvider` | what each character is told (persona and prompt), including what happened in earlier rounds | the same scene for everyone, plus the character's own definition |
| `CharacterOutputValidator` | whether a character's answer is usable | the intent is not empty |
| `RetryPolicy` | who acts again after round one | failed and high commitment |
| `InputValidator` | whether the player's input starts a round at all | accepts everything |
| `Author` | makes up characters and places when the story needs them, and fits them into the world later | the world author sub-agent; declines everything when none is installed |
| `Committer` | writes the waiting rounds into the story's records, when the game master asks | the record keeper sub-agent; `writesOutcomes` when none is installed |
| `Narrator` | who writes the output | the game master (the boundary returns nothing); with a narrator installed the game master calls `narrate` without segments and the narrator's output is used and checked the same way |
| `NarrationChecker` | whether the output carries the utterances unchanged and in order, and how to correct it when asking again did not help | exact words (ignoring wrapping quotes and whitespace), each once, in the order spoken |
| `SceneContextProvider` | what the game master is told at the start of a turn | the cast with their public state and activity |

A rejected player input skips the round: the game master is told why and may end the turn without activating anyone. A character that fails or answers badly is reported to the game master and does not stop the others.

## Where the code lives

- `src/orchestration.ts` is the preset's plugin entry (built to `lib/orchestration.js`). It is mounted once per preset and shared by every chat that uses it, so all state is kept per chat.
- `tools.ts` defines the two tools; `hooks.ts` the turn gate and the scene injection; `character-runner.ts` starts the character agents; `store.ts` maps a chat to its roleplay session and writes the record; `prompt.ts` holds the game master's instructions.
- `tests/host/orchestration/` covers the engine against fakes, and the whole loop against the real DSH agent loop with a scripted model.

## Rendering

The client (`src/client/transcript/`) reads the output back from the `narrate` tool result (or from the `resolve_round` result when a narrator boundary wrote it) and shows it in the normal Chat, as a node at the session level so it is not folded into the turn's process: narration as paragraphs, each utterance as a bubble with an avatar (first letter, a steady colour per character) and the character's name. A `repaired` output carries a small note.

The output is not stored as a log event of our own: DSH refuses to reload a session whose log has an event type it does not know, and the append API cannot mark one ignorable.

## The opening

A world may carry an `opening_message` (see `world-format.md`): plain text, or a list of narration and lines of the world's characters. A new session's chat then starts with it before the player says anything, without asking a model, and it renders exactly like the output of a turn. It is written as a finished first turn, with the output delivered by a `narrate` call and its result (so the model reads a history that looks like the one it will write), into the chat's stored log *before* the chat's agent exists. The chat is then adopted by id, so the agent loop reads the right turn counter and the player's first message becomes turn 2. A chat that has no opening is unchanged. Because the chat has a message from the start, DSH lists it under its name straight away instead of as a "new session".

## Places in the loop

`resolve_round` outcomes take `moves_to {location, position?, feature?, ignore_exits?}`. `TurnEngine.resolve` checks each
move with `TurnStore.checkMove` (an unreachable place, a locked or blocked way, a failed intent are refused with the
reason, like any bad outcome), `finishRound` applies them with the round's other updates in one transaction, and the
queued `RoundRecord` carries `place` and each entry's `at` / `moved`. The characters' brief shows only the place they are
in and who is there (`CharacterRequest.place`); the scene notice shows the game master everyone's place
(`castSummary`). Activation stays the game master's decision (`activate_characters.characters`); the planner default is
unchanged.

## Growing the world in the loop

`expand_world {need, what}` (game master only) calls `TurnEngine.expand`: refused between a round's activation and its
resolution, for a reason that is not one of `scene_change` / `arrival` / `introduction`, in a closed world, or past the
turn's limit; otherwise the `Author` boundary decides and makes (or declines) and the game master is told what exists now
(a new character is in the cast at once, by its key). After a turn is delivered the engine fits what is waiting into the
world in the background (`consolidateIfDue`: one run at a time per chat, never awaited by the turn, a failure is logged and
leaves the items queued). The world author is built like the keeper (`runChild`, tools of its own, a gate in front of
`submit_result`); its tools are the reading tools of the state package, `world_lint`, `edit_world` (and, when fitting in,
`list_consolidation`, `resolve_consolidation`).

## Things in the loop

`resolve_round` outcomes take `item_changes`. `TurnEngine.resolve` hands all of them to `TurnStore.checkItemChanges` (a dry run in a transaction that is always
undone, so a change sees what the one before did; a character whose intent failed does nothing with things), and `finishRound` applies them with the round's
other updates in `commit` (things first, then the move: what a character does happens where it is). What came of each is in the round's `things` for the game
master and in each queued entry's `items` for the keeper. `expand_world` has the reason `object`. The characters' brief shows `carrying` and the place's
`items`; `castSummary` gets `SceneItems` (what lies where, hidden too, and what each character has).

## Time in the loop

At the start of a turn the pre-step hook calls `TurnStore.beginTurn` (when time follows the wall clock it moves the story clock to now and reports how long the
player was away) and gives the result to the scene. `resolve_round` takes `elapsed_seconds`, checked in `TurnEngine.resolve` (refused for real time; a whole
number from 0 to a day), and `finishRound` calls `TurnStore.endRound`, whose result is in the round's report and in the queued `RoundRecord.time` for the
keeper. `advance_time` is `TurnEngine.advanceTime` (between rounds only; refused for real time), implemented over `host/clock/story-clock.ts`, where the rules
of both modes live. Characters get `CharacterRequest.time`.

The player's character can have an outcome in `resolve_round` (`TurnEngine.check` accepts its key at the first resolve of a round; `decisions` gives it a stand-in report made of the outcome, so moves, things, the record and the keeper treat it like any character; `CommitEntry.player`). Alone, the outcome is a round of its own (`resolvePlayer`). The player's journey sets the minimum time of the round (`endRound`'s `minimum`).

## The days of the characters in the loop

After `deliver`, `TurnEngine.offSceneIfDue` asks the characters away from the player about what fell due (`TurnStore.dueOffScene`, `markHandled`), reusing `runAttempt` with the item's text as the situation; the `narrate` tool passes the character runner for it. Results are committed and queued as a `RoundRecord` with `offstage: true` (rounds from `OFFSTAGE_ROUND`). The run is bounded by `offstage.perTurn` (characters) and `offstage.perCharacter` (asks per character) and nothing starts it but a delivered turn. With `offstage.summary` the characters are given `AWAY_ACTION_SCHEMA` (`CharacterRequest.away`), which adds a required one-line `account` to their answer, and `addNote('away', ...)` collects the lines, so the summary costs no request of its own.


`TurnStore.beginTurn` also runs the catch-up of routines (`host/clock/passage.ts`: `startTurn`, `passRound`, `skipAhead` over `host/clock/agenda.ts`) and returns the
scene's agenda; `endRound` and `skipTime` return who moved, which the game master reads in `resolve_round` and `advance_time`. `CharacterRequest.agenda`
(`TurnStore.agenda`) is the character's own agenda. The keeper brief lists goals and engagements with ids and its persona says when to write them.

## The preview of the scene

A turn is slow: the game master thinks, calls tools, asks the characters, and only then delivers. So that something is on screen early, the game master first calls
`preview_scene` (`TurnEngine.preview`, chat setting `preview.enabled`, default on): two or three sentences that set the scene and end on the open question, without
deciding anything for a character. `activate_characters` and an idle `resolve_round` are refused until it was shown (`previewDue`; `explain`, which the turn gate also
uses, says so), at most once per message and at most 700 characters. The result carries the text as `<roleplay-preview>{json}</roleplay-preview>` (`shared/narration.ts`
`encodePreview`/`decodePreview`), so, as for the output, no custom event is needed. The client turns it into a `roleplay-preview` node (`client/transcript/definitions.ts`
`chatPreview`, placed at the session level so the Chat leaves it in the transcript); `PreviewNode` renders nothing once a later `roleplay-narration` node exists. The log keeps
both. The preview is part of the game master's own conversation, so its narration may keep, rework or ignore it; it must stand on its own, and the characters never see it. The setting is read for each turn: a chat with `preview.enabled` off has neither the instruction in the game master's prompt nor the tool (it is registered on the chat's own agent only while the setting is on), and nothing is refused for lack of it.

## Suggested actions and notes

After the output of a turn is delivered, `TurnEngine.suggestAfter` asks the `suggester` boundary, in the background and without waiting, for exactly `suggestions.count`
(default 3, 0 turns it off) short first-person lines the player could send next. The production suggester (`host/orchestration/suggester.ts`, `suggestionWriter`) is a child
agent (`runChild`) with no tools but `submit_result`, which sees only what the player just read (the output as text), the player's character and its place: nothing
secret can reach the suggestions. `suggestionProblems` (exact count, not empty, at most 200 characters, different from each other) checks the lines, both in the child's
`beforeSubmit` and in the engine. A child that stops without submitting is reminded twice (`runChild`).
When the suggester fails or its lines are refused, the engine fills the tray from the story's own data instead (`host/orchestration/suggestion-fallback.ts`: someone present, an open way, a visible thing, then plain standbys; no model call), so the player is not left with none. The failure is still reported.

The result is a *note* (`shared/notes.ts`, `host/sessions/notes.ts`): lines of one kind kept in the session's metadata under `notes`, for the player's screen and not
for the conversation. `GET /roleplay-api/sessions/notes?id=` returns them; the next turn clears them (`TurnStore.clearNotes`, at the first step), and a result that
arrives after its turn is over is dropped. The client shows the suggestions as chips stacked above the input, in a `conversation.input.dock` entry
(`client/transcript/SuggestionsDock.tsx`): it asks for the notes when a new output appears and every two seconds for about a minute until they are there, hides while a turn
runs or once the player sent something after the output, and fills the input with the session's own input facade (`conversation.input.for(actx).setDraft`, resolved
on use through `ctx.get('sessions')`). The `away` note (what other characters did meanwhile) is shown as a card above the chips by the same dock, from the same notes; it is filled by the turn's start (routine moves) and by the off-stage run (accounts), so the dock updates it while it polls. The `world` note is written once, when a session starts: the findings of `lintWorld` on the new session (errors first, at most 8), shown as the card *Unfinished in this world* until the first turn clears it. Other temporary displays are new kinds of notes.

Two more background jobs follow a delivered turn. The **faction strategist** (`host/factions/strategist.ts`, boundary `strategist`): at most `factions.perTurn` organisations with an active goal whose last decision (metadata `strategy.last`, started when first seen) is `factions.everyDays` old each decide one thing in one request; the result changes their state and goals and adds a sealed event no one perceives. The **trigger judge** (`host/triggers/judge.ts`, boundary `judge`): in one request it judges up to `triggers.judgedPerTurn` statements of `judged` conditions of dormant triggers, longest unjudged first; verdicts live in metadata `triggers.judged` and `runTriggers` reads them (`TriggerClock.judged`), so firing stays deterministic and happens at the next look. Off-stage characters of one commitment are asked one after another when `offstage.joint` is on, each told who has already decided to come.

Before the pass, each belief with something that bears on it (`bearingOn`: up to four fresh perceptions whose events involve the characters it is about, then those that share at least two words with it) is checked in a request of its own (prompt `roleplay/reflection-check`, result `{ reason, things, verdict }`, `checkProblem` is its gate, at most six per character): can the belief and those things be true together? Each contradiction found (`Contradiction`) is turned into a `doubt` entry by `withDoubts`, which replaces what the pass itself proposes for that belief (revise, drop, doubt), and the brief marks the belief as disputed. `settleProposal` mends a proposal's mechanical mistakes instead of refusing them, because the 35B re-sent the same refused call until the pass was lost: things cited that were not shown or came before the belief, beliefs that do not exist or are named twice, names that are not characters, a confidence the evidence cannot carry, an over-long new belief (cut at a sentence) or an over-long rewrite of an existing one (its words are kept), and new beliefs that rest on a single turn without a decisive event (left out). `proposalProblems` still refuses what needs judgment. A character whose sorting fails is tried again once with the older half of what it took in; if it still fails the others go on, its cursor stays, and the status says it will be tried again. A check that fails only means no doubt this time. Both requests have a declared output budget.

The **reflection** (`host/memory/reflection.ts`, boundary `reflector`, settings `reflection.*`, prompt `roleplay/reflection`) sorts what characters took in into beliefs. `dueReflection` decides after each delivered turn: `reflection.minTurns` must have passed since the last pass (metadata `reflection.last`), then it is due after `everyTurns` turns, or when the scene changed since the anchor (metadata `reflection.anchor`: the player's place and the story time at the last pass; a different place that is not inside or around it by `sameScene`, or `sceneDays` of story time). The first look only sets the anchor. `materialOf` takes agent characters of kind person and a tier above background with at least `minNew` (a manual pass: one) perceptions of sealed events after their cursor (metadata `reflection.cursor`, per character; only up to the first perception of a draft event, so nothing is passed over that is sealed later), at most 40 at a time, the most first; an automatic pass takes `perRun` of them. Each character is one `runChild` (kind `records`) that sees its own perceptions (numbered p) and beliefs (numbered b, at most 40) and answers with `add`, `revise` and `drop`; `proposalProblems` refuses the answer unless every change names perceptions it was shown: a new belief needs two different turns (or one event of importance 4 or more), a new `sure` belief needs support from two turns, lowering confidence needs contradictory evidence, a revision or drop needs something from after the belief's turn, a drop may instead be merged into a belief that stays, at most 4 new beliefs and 10 changes, names of people must resolve. Supporting and contradicting perception IDs, together with confidence, are written with the belief edit. The edit (`beliefs`, `beliefEdits`, `beliefRetractions`, no events) and the cursor are written in one transaction per character, so a failure leaves the characters not yet done as they were. Manual passes: `POST /sessions/reflect?id=` (`TurnEngine.reflect`: writes the waiting records first, refused with 409 while a turn is in play or a pass runs, 202 otherwise), the result in metadata `reflection.last` and a failure in `reflection.error`, both in the settings payload (`reflection`, `ReflectionStatus`).

A beat or cue is **written when it is told**, not when its trigger fired (`records/deferred.ts`, `Session.deliverNotes`, `host/triggers/deliver.ts`). A note keeps the effect's words as written (`{kind:key}` placeholders, `records/template.ts`) and its effect is found again by kind and text (`noteEffect`). Where notes are told (`noteStore.pendingBeats` and `cuesFor`, and the report of `fireTriggers`), `deliverNow` asks `deliverNotes`: an effect's `while` (a condition of the same grammar as `when`, `@self` bound to the character of a cue, nothing `judged`) must still hold, and the words are rendered from the story as it stands, with the story's clock; a note that fails either is resolved `lapsed` and the reason is kept in metadata `triggers.withdrawn` (the latest 100), which the interventions list of the chat settings shows as *withdrawn*. Rendering throws `UnwritableError` for what the words name that is not there, which withdraws the note instead of guessing. References are checked when the trigger is made (`triggerReferenceProblems`). No schema change.

Every helper run (`runChild` with a `trace`) is filed in the session metadata `activity` (label, model, duration, calls, error; the latest 60) and listed in the chat settings tab. `models.{characters,records,suggestions,authoring}` give those helpers a model of their own (`childModel`).

## Not waiting for the records

`narrate` returns as soon as the output is checked: the keeper, the world author's consolidation, the off-stage rounds and the suggestions all run in the background.
Whether that work may overlap the next turn's generation is the setting `background.concurrent`. Off (the default), the first step of the next turn waits until nothing of the chat is still writing (`TurnEngine.quiesce`), and `record_memory` only marks the records as asked for, so the keeper starts at delivery instead of beside the game master; one local model then serves one thing at a time and its cache is not pushed out between the game master's steps. On, they may overlap, which is faster when the model is a hosted service that takes requests in parallel.
Scene illustration follows the same rule. A delivered output carries its stable timeline-node id; in `images.mode: every-turn` the image-author child starts in the background, while `manual` exposes the same job from the narration and `off` does nothing. Rewind cancels the live job, and an image failure never changes the delivered turn. Details are in the [image system specification](./image-system).
The records are written one run at a time per chat (`TurnEngine.write`). The next turn does not wait for them to start: its first calls (`judge_action`, `preview_scene`) run while the keeper
finishes. Everything that recalls or changes the story (`activate_characters`, `resolve_round`, `advance_time`, `expand_world`, `narrate`) first calls `TurnEngine.settle(chat, turn)`, which waits for the
run in flight and, for a later turn, retries a failed run once. The state kept for rewind is taken when the turn begins, with the waiting rounds in it (`pending_commits` is in the database), so a restored state
carries them. `reasoning.children` (chat setting) sets the thinking level of the characters, the keeper, the world author and the suggester.

## Triggers in the loop

`TurnStore.runTriggers(turn, round)` (`host/triggers/notes.ts` `fireTriggers`, over the state package's `runTriggers`) is called by the engine at three moments: the first step of a turn
(`TurnEngine.fireAtStart`, round 0, after the clock caught up, so what came true while the player was away fires), after each recorded round (`finishRound`, after `endRound`, so time, moves, items and variables
of the round are in), and after a skip (`advanceTime`). What fired comes back as a `TriggerReport` (`fired[]`: name, events, cues, beats with ids): the game master reads it in the result of `resolve_round` and
`advance_time` (`renderWorld`) and in the scene (`world`: what happened, and the beats still pending); a cue is handed to its character the next time it is asked (`cuesOf`, taken up in the first attempt of a round
and told the same on the retry, `CharacterRequest.cues`). `narrate` takes `addressed` (beat ids): unknown ones are refused, the others are done when the output is delivered. Notes lapse at the start of a turn
(`lapseNotes`). A trigger that cannot be applied is reported through the engine's `problem` and given up; a failure to look at the triggers at all is reported and the round goes on.

Announcements: `TurnStore.upcoming(turn)` (the game master: every announced, not yet fired trigger, who knows, when) and `upcomingFor(characterId, turn)` (those whose audience includes the character, at most three) come from the state package's `announcements` and `inAudience` and the story clock (`host/triggers/notes.ts`); the scene input carries `world.upcoming`, and `CharacterRequest.upcoming` is added to the brief next to the cues. A cue's audience is resolved when it fires (`audienceIds`: characters that can act; the player's character is told by the game master).

## What the player may do, and out-of-character commands

**Ordinary input.** Nothing is refused in code (`acceptsAnyInput`): the game master judges, and must do so first (`judge_action`, `TurnEngine.expectJudgement/judge`: until it has, `activate_characters`, `resolve_round` and `preview_scene` are refused; the tool asks for a `rule_check` that goes through each listed rule before `allowed`, because a model told only to respect the rules was observed to let magic through). The player's character may try anything, however odd. An action fails, in the story, when it is not viable
(what it needs is out of reach, is not there, or the character cannot do it) or when it breaks a rule of the world or of the player: the game master plays it as a round for the player's character
with result `failed` and narrates why; when it was judged not to work nobody is asked to act on it, no preview is shown and the player's outcome may only be `failed`. The rules are the world's (`rules` in `world.json`, copied into the session's metadata at the start) followed by the player's own (`rules.own` in the chat's
settings, one per line); they are listed in the scene notice of every turn.

**Where the action happens.** `judge_action` takes an optional `at` (a place key) for an action the player places at a particular place. `TurnEngine.judge` compares it with the player's character's place (`whereabouts`): the same place, one containing the other, a character with no place or a world with no places are all no evidence and the judgement stands; a place that is neither is a proven mismatch, and the action is judged not to work (the reason is that the character has to go there first), whatever `allowed` was given. An unknown place key is refused with the way to list them.

**Out-of-character questions.** A message that begins with `/ask` is an out-of-character turn like a command (`parseOoc` returns `question`), but the game master only has it answered: `ooc_answer` (no arguments) is its sole action, `ooc_ruling` is refused, and everything that could change the story is refused with the reason (`oocBlock`). The answer is not the game master's to write, since it knows what the player's character does not: `TurnEngine.answer` builds the request the player's character would be given to act (its place and company, what it remembers of the question, what it knows exists, carries, and how it stands with people, with the question as the moment) and an agent without the character sheet or anything else answers from that alone (`answerRunner`, up to 1200 characters, cut beyond). `narrate` is then called with no segments; the answer is `TurnOutput.ooc` with `legal: true` and `question: true`.

**Out-of-character commands.** A message that begins with `/ooc` is a turn of its own (`parseOoc`, in the first step of the turn); it is never mixed with an action. `TurnEngine.beginOoc` marks the
turn: no preview, no character is asked (`activate_characters` is refused). The game master first rules with `ooc_ruling(rule_check, legal, reason)`; only the rules of the world and of the player bind it, so what
the character could not do, the command may (bring things into being with `expand_world`, make any character act or go somewhere with `resolve_round` outcomes for characters that were not asked,
change what is tracked, move time). Nothing may change before the ruling or after an illegal one (`oocBlock`); then `narrate` with narration only (no utterances), or no segments. A decreed outcome goes
through the same checks as any outcome and is recorded as a round (`decree`, entries marked `forced`, which the keeper writes as what happened to the character, never as caused by a command). The reason of
the ruling is the note the player reads above the narration (`TurnOutput.ooc`, `roleplay-ooc` in the transcript). The turn is a normal timeline turn: it can be taken back, regenerated or branched.
Characters perceive what the command changed under the ordinary perception rules.

## Dice in the loop

A chat's game master has the dice tools `roll_check`, `roll_dice` and `list_checks` when its settings say so (`tools.gameMaster`, on by default): each is registered on the game master's agent while the setting allows it and withdrawn when it does not, and the game master prompt carries the `roleplay/dice` text with the world's checks listed (`${dice}`, empty when the agent has none). The rules it is given are the same in every world: roll only when the outcome is uncertain and matters, once per attempt, after `judge_action` and before `resolve_round`, and let the result stand. The dice are rolled by code from the system's random source and each roll is recorded for the turn.

`roll_and_narrate` (`host/orchestration/check-tool.ts`) is an optional fast path, off by default (`tools.gameMaster`). For the player's own uncertain attempt, when nobody else needs to react and nothing moves or changes hands, the game master writes a summary and a narration for every result the check can give; the code rolls, takes the branch the roll chose, records it as the player's round with the roll cited, delivers its narration and ends the turn, in one call instead of `roll_check`, `resolve_round` and `narrate`. The engine checks first (`soloCheckProblem`: an ordinary turn, nobody asked yet, judgement and preview done, the attempt allowed, the player's own character) and the tool checks that every branch the check can give was written, so nothing is rolled in vain. The branches that were not chosen are wasted tokens, and no character reacts to the actual result, which is why it is not the default.

`resolve_round` takes an optional `roll` for each outcome. The engine refuses (and tells the game master why) an outcome whose roll is not of this turn, was a plain roll with no result, was made for another character or already decided another outcome, an outcome that names a roll whose result it does not carry, and an outcome for a character that was rolled for which does not cite the roll. The round's record for the keeper says what the dice decided. What the player sees is the chat setting `dice.visibility`: `card` attaches the turn's rolls to the delivered output, which the transcript shows as a collapsed card, and `hidden` attaches none. A message that begins with `/roll NdM` rolls those dice for the player before the turn and tells the game master the result as a fact; a notation that cannot be read refuses the turn with the reason, like any input the game master is not asked to judge.

## Tools of other plugins

The tools that other plugins registered for everyone (found through the tool registry's global view, minus this plugin's and the state plugin's own and DSH's reserved transport) are off for every agent of a story unless its settings switch them on, by kind of agent (`tools.<agent>.<name>: true`). For the game master the restriction is DSH's `tools.restrict({ deny })` on its agent, set when the agent is created and followed at each step as the settings change, so the first request never lists a tool it was not given. For children (characters, record keeper) the tools they were given are passed as the allow-list of their tool filter (`ChildTask.external`), which is empty by default; a character that has some may make a few more calls than its memory look-ups. `GET /roleplay-api/tools` lists what is registered now for the interface; a name in a story's switches that is not registered is kept and ignored, and tool names may hold letters, digits and `_ . : -`.

DSH's MCP resource plugin also adds a paragraph to every agent's system prompt that names the resource tools and the MCP servers, whether or not the agent can use them. The plugin replaces it, in the agent's scope, with a paragraph that appears only for an agent that can see one of the resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`), in the chat's language, naming the servers that have a tool registered. This holds for any MCP server.



The story's turns are kept in `<session folder>/timeline.json` (outside the database, so that putting the state back never changes it): a tree of `TimelineNode`s, one per turn
played, each with the turn it follows, the log seq of the player's message (`userSeq`) and where the turn ends (`endSeq`, `startSeq`), what was said, what was delivered and the name
of the state snapshot taken after it; `head` is where the story stands. A turn is added when it begins (`Timelines.begin`, in the first step), its output when it is delivered
(`delivered`), its place in the log when it ends (`ended`, from `session/event`). The state is snapshotted when what the turn wrote has settled (`TurnEngine.quiesce`, which waits for the
records, the consolidation and the characters away), as `snapshots/after-<id>.sqlite`; `start` holds the state before the first turn. `rewind.keepSnapshots` (default 30) keeps the latest
ones; a turn without one cannot be returned to.

`Timelines.move(chat, target)` takes the story to the state after a turn (`null` for the start): what is running is cancelled and stopped, the database is put back from the snapshot
(`roleplayState.restore`, which releases the connection), the turns that no longer belong are replaced on the model's conversation by one marker per run (`planMove`), and the turns that
come back are told once each as a notice (`noticeText`); the chat's log is only ever added to. The call returns the first message that was left, for the input. The client (`TurnsDock`)
offers regenerate (move to the parent and send the same words), rewind (move to before a turn and put its words in the input), swapping the last turn for another played from the same
state, and forward again; what belongs to turns the story is not at is left out of the transcript. Over HTTP: `GET /roleplay-api/sessions/timeline?id=`, `POST .../timeline/move?id=&to=`
(`start` for the start; 409 when the state was not kept).

## Branching a story

A branch is a new session made from the story as it stood after one of its turns, in a chat of its own; the first session is not touched. DSH makes the chat (its own fork: a
new `session-<uuid>` seeded with the log up to the cut), and the host gives that chat a session: the creation of a chat that is seeded from a roleplay chat (`agent/created`) is
heard by the orchestration, which makes the session folder from the state at the cut (`Timelines.adopt`, `roleplayState.fork`): the database from the snapshot of the last turn that
ended at or before the cut (or from the live state when the story stands there and has not kept one yet), the settings, the kept snapshots, the turns it inherits (`branchTimeline`),
and the identity of the new session (its id is the chat's uuid) and a name counted up from the first. The new chat's conversation is made to carry exactly those turns (markers and
notices, as for taking the story back). When the state at the cut was not kept the branch is refused and nothing is made. A chat that is loaded again keeps the session it has.
The chat dock offers "Branch from..." for each turn; once the new chat opens the player is asked for a name (`POST /sessions/rename`), which is also the chat's title. Forking a chat that
is not a roleplay session is DSH's own and is not touched.

## Putting sessions away and deleting them

Archiving a session (`POST /sessions/archive`) hides and stops its chat (DSH's registry) and writes `status.json` beside the database (`archivedAt`); the session stays in the list,
marked, with its story and turns as they were, and cannot be opened (409) until it is restored (`POST /sessions/restore`), which only the roleplay Sessions page offers. Deleting
(`DELETE /sessions/item`) removes the chat's log and the logs of everything it started (`host/agent/purge.ts`, see the [DSH API contract](./dsh-api-contract)), and then the session's folder; if the chat
cannot be removed completely the session stays, so that deleting can be tried again.

## Where the time of a turn goes

`node scripts/turn-report.mjs <roleplay session uuid> [turns]` reads DSH's stored logs (it needs the `zstd` command) and prints, for the last turns of a chat, the total time, how long the first request waited, each of the game master's calls with its offset and every refusal, and the helpers (characters, keeper, authors, suggestions) that ran during it with their duration and calls.

## Things the game master brings in

`introduce_thing` makes a thing the story is about to use (a barricade, a tool, a note) at once, as a table's game master would: where it lies (a place, the player's by default), in whose hands, or inside which container, with no world author asked (`TurnEngine.introduce`). It is limited per turn by `authoring.thingsPerTurn` (default 4; 0 turns it off) and not available in a closed world. The thing is queued like other made-up things for fitting in. `expand_world` with reason `object` remains for things important or complex enough to need inventing.
