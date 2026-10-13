---
title: Story state and memory specification
description: Records, recall, world state, time, routines, variables, triggers, and context compaction.
---

How the story is remembered, by the characters and by the game master, and how the
conversation stays a size the model can take. Everything below is stored in the
session's database (`session.sqlite`) except the per-chat settings, which are a file
(`settings.json`) next to it.

## What is recorded

The tiers are **turn -> event -> perception -> memory**. A turn is a player message and everything under it (rounds of characters). When the game master decides the story moved on, a **memory keeper** (a tool-using agent that writes and then reads back what it wrote; see `orchestration.md`) turns the rounds waiting since the last record into:

- **Events**: what objectively happened, as short past-tense statements with an
  importance from 1 to 5, tags and the characters involved. They are the ground truth and
  **immutable**: drafts while the keeper that wrote them verifies, sealed when its run
  completes.
- **Perceptions**: for each event, who took it in and how (witnessed, heard, told,
  inferred), in that character's own terms, with a gist (what is left as it fades) and an
  accuracy label (accurate, partial, mistaken) that is kept for checking and never shown
  to the character. A character may take in something incomplete or wrong.
  A character who was not there perceives nothing. Perceptions are **mutable**: a character may
  later learn more, remember it differently (`perception_edits`), or take in an old event only
  now because it was told (`perceptions_added`). The event itself never changes.
- **Beliefs** (memories proper): what a character has come to believe or know beyond a single event
  (belief, relationship, knowledge), from its own point of view. They are mutable.
- **Story threads**: promises, mysteries and goals that are not settled yet.
- **Character state**: public state, inner state, activity and emotion, as before.

Rounds are queued in the database (`pending_commits`) when they are recorded and stay there
until a keeper run has written them, so a quiet stretch costs no model calls and is written
together with the next thing that matters. A failed run leaves them queued, silently: nothing
about it reaches the output. The chat settings tab shows how many are waiting.

## What a character remembers

Characters are one-shot agents, so each activation is told what the moment calls to mind
(`@dsh-agentic-roleplay/state`, `session.recallRanked()`, reached through the core's `recaller` boundary). Reminding is a
pipeline of retrieve, judge and choose:

1. **Retrieve with three searches**, each scoring the character's own perceptions and beliefs from 0 to 1:
   the **cues** of the moment (who it names by name or alias, strengthened when the remembering character's directional relationship to that person is tense, distrustful or emotionally strong; words it shares with the text and tags; scripts
   written without spaces by pairs of characters, being where it happened), the **words** of the session's index
   (FTS5, scores relative to the best hit; words found in most texts are ignored), and the **meaning** of the
   stored vectors (sqlite-vec, cosine similarity; below about 0.3 counts as nothing). The vector search only
   runs when the embedding service and stored vectors exist.
2. **Fuse the scores**: a weighted average over the searches that ran (cues 1, words 1, meaning 1.5), so something
   two searches found beats something one found, and a search that found nothing takes no part.
3. **Over-retrieve**: keep `memory.overRetrieve` x `memory.recall` candidates (default 4 x 12, at most 60) ranked
   by fused relevance together with how much each matters and how recent it is. What has faded away entirely (with
   imperfect memory) is not kept.
4. **Rerank** the pool, when a reranking service is configured: it reads the situation with each candidate and scores
   it from 0 to 1. A candidate's relevance becomes 70% that and 30% the fused retrieval score. Without a service,
   or if it fails (reported once in the log), retrieval alone decides.
5. **Choose** the best `memory.recall` by relevance, importance and recency, and tell each in the way it is
   remembered, in the order it happened.
6. **Associate**: up to `memory.associate` (default 2) more come to mind because they are strongly tied to something
   the moment really matched: the same people together with the same tag or place (or two of the same people), and
   important enough (3 or more). They are marked as coming to mind with the rest. Nothing matching the moment means
   nothing is associated.

What comes back is the character's own version, not the facts. Memories that nothing matches still come back
by importance and recency (a character always remembers something recent that mattered).

**Imperfect memory** (`memory.flaky`, on by default) makes memories fade at recall time,
deterministically: the retention of a memory is `0.5 ^ (story days / half-life)`. An
unimportant event has a six-story-day half-life; the half-life doubles with each step of importance, grows with every time it was recalled,
is four times longer for beliefs, and is varied a little per memory (seeded by its id).
A cue in the situation brings back part of what faded. Retention maps to how it is told:
clear (the full version), faded (the gist, "the details are fuzzy"), vague (only who it
involved, "you barely remember"), or gone. Importance 5 never fades below faded. When a
character takes something in wrongly, that was decided by the record keeper when the
event happened (it is told whether this chat allows it), not at recall. With `flaky` off
everything is clear, nothing is forgotten, and every perception is accurate.

Age and recency come only from the story clock, never from turn count or wall time. An
event is dated at the beginning of its round; a belief is dated at the first recorded
instant of the turn in which it formed. A hundred turns in one story minute therefore
barely age a memory, while a single turn that skips several days can fade it. Character
briefs describe that elapsed story time directly (for example, "3 days ago"). A session
whose story clock has not started has no elapsed story time yet, so its memories do not fade.

Recall is a boundary (`Recaller`). The default is cue-based because DSH has no embedding
or reranking service; a recaller that scores by meaning can replace it, and the scoring
inputs (importance, retention, recency) stay available to it.

## What the game master reads

The conversation is sent whole until it reaches `context.limitTokens`, or, when that is 0 (the default), `context.limitRatio` (60%) of the selected
model's context window (at least 4000 tokens; the window comes from the provider's model entry, and a chat that has no limit and a model with no known window
fails loudly). Then
`RoleplayCompaction` (a subclass of DSH's basic compaction engine that overrides only
the summarizer, mounted in the preset) folds the oldest **whole turns** out of the
conversation, keeping at least `context.retainRatio` of the limit as it is. DSH does the
rest: the surface replacement, the log markers, the pairing of tool calls.

The summaries are written from the events, not from the earlier summary text. A
**chronicler** (a one-shot sub-agent with no tools) writes:

- a **digest** of the turns that just left, from their events and what the player did
  (from the conversation itself where a turn has no events),
- a **chapter** when the short-term digests exceed `context.shortTermTokens`: the oldest
  digests condensed, with the important events of those turns as the authority,
- a merged chapter when the chapters exceed `context.longTermTokens`.

They are stored in `summaries`, so each is written once and the account is rebuilt from
the database. The head of the conversation is the long-term account, then the short-term
one. Between folds the conversation only grows at its tail, so the provider's prefix
cache holds; a fold changes the head once every many turns.

The tail of each turn carries what changes: the state of the scene, the open story
threads, and the earlier events that the player's move brings to mind, if they have
already been folded away (so the detail a summary lost can be recovered).

## Settings

`settings.json` in the session folder (all optional). They can be set before a session starts
(the start dialog has a folded *Advanced settings* section whose values are written before the
first message) and changed later in the Chat settings tab, which edits the first seven.

They are read again before each use, not at start: the number of rounds at each activation, the
memory policy when a character is activated and when the record keeper runs, the context limits
at every step of the agent loop (where compaction is considered). The file is parsed again only
when it changed. An edit that makes it invalid is reported once in the log and the last good
settings stay in force, so a typo cannot stop a story in the middle.

| Setting | Default | |
|---|---|---|
| `maxRounds` | 3 | most rounds of characters per player message |
| `maxCharacters` | 4 | most characters asked to act in one round |
| `memory.flaky` | true | imperfect memory and perception |
| `memory.recall` | 12 | most things a character is reminded of per action |
| `memory.lookup` | true | a character can ask itself about more of its own memories while it decides |
| `memory.overRetrieve` | 4 | how many times `memory.recall` candidates are retrieved before the best are chosen; a reranker judges the wider net, and 1 chooses straight from retrieval |
| `memory.associate` | 2 | the most extra memories that come to mind because they are strongly tied to what the moment recalled; 0 turns it off |
| `memory.verify` | true | the record keeper must read back what it wrote and compare it with the round before it finishes |
| `context.limitTokens` | 0 | size at which the oldest turns are folded; 0 follows the model |
| `context.limitRatio` | 0.6 | with no limit given, the share of the model's context window |
| `context.retainRatio` | 0.5 | share of the limit kept as it is |
| `context.shortTermTokens` | 1500 | size of the short-term account |
| `context.longTermTokens` | 2500 | size of the long-term account |
| `embedding.options` | none | what the embedding provider lets a request set for this chat, by its own option names (the OpenAI provider: `dimensions`, `user`); offered in the settings tab from what the provider describes, and the start dialog shows only what must be chosen before the first request |

## The search index and vectors

Every perception, belief and event is also a row of `recall_items` (kept in step by the
repositories), indexed by words in `recall_fts` and, once a text has a vector, by meaning in a
sqlite-vec table (`recall_vec`, partitioned by character so a character's search never sees
another's). Vectors come from the embedding plugin (`ctx.embeddings`, optional) and are made in the
background after each keeper run and whenever a search finds texts without one
(`host/memory/embedding-index.ts`): texts go as documents, the moment as a query, with the chat's
`embedding.options`. The first vectors fix the session's model and dimensions; vectors from another
model are refused and the search goes by words until they are reset. A changed text drops its vector.
Without the plugin, a failing provider or sqlite-vec missing, everything still works on cues and words.

There are two injection points, both without an LLM call of their own besides the embedding:

1. **At the start of a character's turn** the situation is searched (cues + words + meaning) and the
   best `memory.recall` memories are put in its prompt (`Recaller` boundary).
2. **While it decides** (`memory.lookup`) the character can call `recall_my_memories` with keywords or
   a description, which uses the same search over its own memories only. The game master's and the
   keeper's `search_events` use the index too (best match first).

## Places

A session has places (`locations`, with `features`), the ways between them (`exits`, one direction each, state
`open` / `locked` / `blocked`) and placements (`placements`: which place each character stands in, where in it,
at which feature; the same table will place items). They are copied from the world when the session starts.

- **Movement** is decided by the game master: an outcome of `resolve_round` may carry `moves_to`. The engine
  checks it before the round is recorded (a way over open exits must exist; a character whose intent failed does
  not move) and the game master is told why when it cannot. The move is applied in the same transaction as the
  round's other state, and the round that is queued for the memory keeper records where each character was
  (`at`) and where it went (`moved`), and the place of the moment (the player's character's place).
- **Events happen somewhere**: an event has a `location`; the keeper is told to give one, and perceptions are
  for the characters who were there (or could hear and see from nearby). The place's name is indexed with the
  event, so what happened "in the cellar" is found by those words.
- **Recall**: a character at a place is reminded of what happened at that place more readily (a cue as strong as
  sharing two words), without any embedding. `search_events` can be narrowed to a place.
- **What each is told**: a character is told the place it is in (description, features, ways out) and only who is
  there. The game master is told where the player is and what is there, who is with them, and who is elsewhere
  and where, and chooses whom to activate. At most 12 features and 12 exits of a place are listed.
- **Changes in play** go through the keeper's edit like everything else: `places` (a place the story makes up,
  with exits), `place_edits`, `exit_changes` (a door unlocked, a passage collapsed; both directions unless
  one-way) and `moves`. The model-facing tools are `list_locations`, `get_location`, and with write tools
  `move_character`.

## Relationships

How characters stand towards each other is a **profile per direction** (`relationships`: from, to, a label, a
sentence, and familiarity, trust, affinity, tension), not a single edge. The world's files seed them (`character.json`
`relationships`); in play the keeper records a change when something really changes how a character stands towards
another (not for every pleasantry), and the world author gives characters made up in play theirs. A character is told its
own profile of each character it is with (the label, the sentence, and what the numbers come to in words). This is
separate from beliefs (what a character recalls and believes), which stay memories. The graph is also character
awareness: no outgoing profile means the other character is unknown. Seeing someone creates a neutral `acquaintance`
profile; being told of someone is recorded as a profile from the character that learned of them.

## Entity knowledge

Knowledge of non-character entities is an explicit, closed-world graph (`entity_knowledge`): one directional edge from
a character to a location, item, directed exit or lore entry. No edge means the entity is unknown. For physical entities an edge means only that the
character can identify it; it never supplies current whereabouts, ownership, contents, occupants or state. Knowledge is
not transitively expanded.

`character.json` may seed `knowledge.locations`, `knowledge.items`, directed `knowledge.exits` and `knowledge.lore`. Code records ordinary
observation: the current place, its visible ways and their named destinations, visible items, carried items, and characters
present. The keeper adds `knowledge` when a character is told, reads or infers that an entity exists; retractions are only
for erroneous records. The character brief lists the known subgraph and `recall_my_known_entities` searches it without
revealing current facts. Intended travel is planned by `planKnownMove`, over known destinations and exits only; forced
story movement retains the omniscient authoritative planner.

Lore differs from a physical-entity edge only in what lookup returns: `recall_my_lore` may return the canonical text of explicitly known entries. It never searches unknown lore. The game master's `search_lore` searches the full canonical lore repository.

## Growing the world

The world is extended only when the story genuinely needs it, and only by one agent, the **world author**
(`host/authoring/author-agent.ts`), asked by the game master through `expand_world {need, what}`.

- **When**: `need` is `scene_change` (the story has gone somewhere no known place covers), `arrival` (someone new has
  actually arrived or been brought in) or `introduction` (a specific, established person who has not appeared is needed
  by what is happening now). Never for colour, atmosphere, a passer-by, a crowd or something mentioned in passing, and
  not when an existing character or place can serve. The author's persona states this bar, tells it to look first and
  reuse, and says that declining is a good outcome; the game master's tool description and protocol say the same.
- **Enforced in code**: the world can be closed (`authoring.enabled`); at most `authoring.perTurn` things per turn
  (counted from the queue, enforced in the tool and in the author's own edit); a character with the name or an alias of one
  that exists is refused (naming the one to reuse); a made-up place has to be connected and a made-up character placed (the
  author cannot finish while `world_lint` shows an error about what it made).
- **What it makes**: with `edit_world` (the authoring variant of the edit wire format, atomic): characters (always played by an
  agent, never playable) with state, place and a note on why; places with features and ways; ways between places;
  relationship profiles. No other agent can make anything: the keeper and the write tools are not offered
  these.
- **Fitting in later**: everything made is queued (`consolidation_items`). It is connected as far as the moment needed;
  the rest is done in the background, after the turn is delivered, once `authoring.consolidateAfter` things wait or one has
  waited four turns: the author is run again with everything waiting, its surroundings (who the character met and what
  it took in, a place's neighbours) and `world_lint`, connects ways and relationships, resolves each item with what it did,
  and cannot finish before everything is resolved and no lint error remains. It never makes anything new then. A failed run
  leaves everything queued, silently.
- **`world_lint`** (deterministic, in the state package) finds: a place no one can reach or leave (an error for what was made up,
  a warning otherwise), places no chain of exits reaches from the player, a character in no place, two characters (or two
  places in one place) with the same name (errors), a made-up character with no relationship, ways with no way back and
  one-sided profiles (information only).

## Things

An **item** is one kind of thing for everything physical (items, equipment and containers of the old design are one):
quantity, uniqueness, condition, `notable`, `hidden`, the slot it is worn in, a container state (`open`, `closed`, `locked`) and what opens it, an owner.
It is held by exactly one holder: lying in a place (with a position and a feature), carried or worn by a character (worn in a slot), or inside a
container item; where it is is derived by following what holds it. Ownership is separate from possession. Slots are session data with
defaults (`DEFAULT_SLOTS`), and a world or the story can add its own.

- **What characters do with things is decided in code.** A `resolve_round` outcome can carry `item_changes` (take, drop, give, put, wear, remove, open, close,
  lock, unlock, reveal). The engine tries them in order across all the outcomes in a dry run (a later change sees the earlier ones) and the game master is
  told every reason it cannot (not here, hidden, inside a closed or locked container, held by someone else, not carried, a full slot, the wrong key, a key
  not in hand, a quantity that is not there), before the round is recorded. `forced` is for the story breaking a lock. A lock on an exit uses the same
  rules (`exit`). Part of a pile is split off and joins a pile of the same kind where it lands.
- **Visible by rule**: hidden things and what is in closed or locked containers are not shown to characters and cannot be reached; worn things and
  things in open containers are. The game master and the tools see everything.
- **What each is told**: a character, what it has on it and what lies in its place (the sentence of each: count, condition, state, where, what an open
  container holds); the game master, what lies in the player's place (hidden things marked) and what each character has on them. At most 12 are listed at
  once, notable first.
- **Memory**: an event lists the items it is about, which also index it by their names; `search_events` takes an item. The keeper's record of a round
  includes what was done with things, and it never moves them itself.
- **Growing the world**: a thing that matters that was handed over, found or drawn and does not exist is made by the world author (`expand_world` with the
  reason `object`; the same bar as for characters and places, "scenery and props are not needed", counted in `authoring.perTurn`), starting in exactly one
  place, and queued for consolidation (owner, what opens a lock). The author also adds a slot when something established cannot be worn in any existing one.
- **`world_lint`** adds a lock that nothing is known to open (a warning for what was made up, information otherwise; also for a locked way with no key and no
  note) and two separate items of the same name in the same place (they could be one with a quantity).

## Time

A session has a **story clock**: the instant it is in the story (UTC milliseconds, read in the time zone of the chat's settings). Two modes, chosen per chat
(`clock.mode`). Real can be left for simulated (the time stops following the clock where it stands, and the story's own dates go on from there), but simulated cannot become real: the story has its own dates, so the settings refuse it and the form disables the choice:

- **simulated**: time moves only with the story. Each recorded round takes what the game master says (`elapsed_seconds` of `resolve_round`, up to a day) or
  the chat's default (`clock.roundSeconds`, 30). The game master skips a stretch it summarises with `advance_time` between rounds (`by_minutes`, or
  `until_time` as `HH:MM` with `days_later`; at most `clock.maxSkipDays`, 30, in one go), with a reason that is kept. The story starts at the world's
  `starting_time`, or at the minute the session was made.
- **real**: the story's time is the wall clock. It begins at the wall clock when the mode is chosen (even when the story had run ahead of it), never goes
  back, cannot be skipped, and a round takes as long as it really took. When the player comes back after being away for five minutes or more, the game master
  is told how long, and that the story went on meanwhile; what the characters did in that time is its to account for.

Each step is kept in `time_log` (`start`, `elapsed`, `real`, `skip`, `resync`) with the turn and round; where an event of a round sits in time is the
instant the round began (`session.clock.at(turn, round)`). Changing the mode is a `resync` step, only from real to simulated, at the later of the story's time and the wall clock. The time zone only decides how instants read; the game master is told the time as `Friday 4 October 1912, 21:40 (evening)` at
the start of each turn and after each round, each character as `Now: ...`, and the record keeper is given when each round began and how long it took.

The helpers a schedule will need are in the state package: `inWindow` (half-open minute-of-day windows that wrap midnight), `catchUpPlan` (only the newest
bounded part of a gap, in a bounded number of steps), `nextTimeOfDay`, `parseInstant`, `describeInstant`, `describeDuration`, `dayPart`. Calendars are
Gregorian (what `Intl` knows): a world with its own calendar reads its times through the prompt for now.

## The player's character in a round

The player's character is never asked to act, but `resolve_round` may include an outcome for it (by its key), when what the player did moves it (`moves_to`
over open ways; `ignore_exits` when the story itself carries or forces it) or has it handle things (`item_changes`). The same checks apply as for any
character, and it is recorded with the round (the keeper sees it as the player's character, what was decided it did). With no one else to react, the outcome
may be the only one: `resolve_round` then makes a round of its own without `activate_characters`; it counts against the chat's rounds. In simulated time a
round takes at least as long as the journey the player's character made (the exits' `travel_seconds`, when every exit on the way has one), whatever
`elapsed_seconds` says.

## Days, commitments and goals

Three layers say what a character is up to, merged by code (`agendaAt` in the state package):

- **Routine**: the recurring windows of the character's day (`routine_windows`), authored in `character.json` or made by the world author. A window holds
  by the clock of the story's zone and the day of the week; the first that fits applies.
- **Engagements**: dated commitments (`engagements`: title, when, where, who, status pending/kept/missed/cancelled). They come from the story, written by
  the record keeper (`engagements`, `engagement_edits`; times as `1912-10-05T21:00` in the story's zone). Nothing in code decides whether one was kept: a
  pending one past its time stays pending and is shown as overdue to the character and the game master, and the keeper concludes it from what the rounds show.
- **Goals**: the character's intents (what it is after: type, priority, urgency, deadline, plan). Authored at the start, and added and moved on by the keeper
  (`intents_added`, `intent_edits`). The most pressing active ones are ranked by priority, urgency and how close or past the deadline is.

Where it shows up: each character's brief has *Your day and what you are after* (now, next, what it is due to do, its top three goals), framed as plans and
not orders, so the character decides whether to keep to them; the game master's scene says who went where by their routines, whose day expects them elsewhere
(only characters with the player's character) and which commitments are due within half an hour or overdue (at most six); the keeper's brief lists the live
goals and pending engagements with their ids; `get_agenda` reads one character's whole day.

Catch-up is code, with no model: whenever the story's time moves (turn start, a round, a skip), characters not in the player's place whose window changed since
the last catch-up go where it has them (without regard to exits: the time passed) and take up its activity; the cursor is `agenda.cursor` in the session
metadata. A character with no routine, not a background one or a group, that was away while time passed is queued once (`consolidation_items`, at most three
at a time) for the world author, who gives it one with `routines` when its role implies a day.

### Off stage

After a turn is delivered, in the background, characters away from the player's character are asked what they do about what fell due for them: a commitment
whose time has come (every participant an agent, none with the player), and a goal whose deadline has passed (`host/clock/offscene.ts`, `dueOffScene`). At most
`offstage.perTurn` (default 2, 0 is off) characters per turn, oldest item first, one run at a time per chat; each item is asked once (`offscene.handled` in the
session metadata), and an item nobody could answer is asked again another time. Each character is told the situation as its own (what it was to do, with whom,
that nobody sees it) through the ordinary brief, with its day, memories and goals. What it decides stands: its activity is set to its intent, and when its
commitment is medium or high and the item has a place, it goes there (exits ignored). The round is recorded as a round *off stage* (round numbers from 100, so they
never collide with the game master's rounds) which only the characters in it perceive, and the record keeper is run at once: it writes what they did and concludes the
engagement (kept, missed, cancelled) or moves the goal on.

Nothing runs while the player is away from the chat: there is no timer, so a session left open costs nothing. What the world does without the player is bounded by
what one player message can start: `offstage.perTurn` characters in all (default 2) and `offstage.perCharacter` times each (default 1; a character with several
things due is asked about the first, the rest wait for the next turn). Items beyond the limits stay due and are taken up by later turns, a few at a time.

With `offstage.summary` (default on) the same request also yields the summary. The away schema (`AWAY_ACTION_SCHEMA`) is the character's answer plus a required
`account`: one sentence, third person, past tense, as someone who saw it from outside would tell it, without thoughts or secrets (`CharacterRequest.away`; the
account is kept to 300 characters). The accounts of a turn, and who went where by their routines when the turn began (`SceneAgenda.moved`, no request at all), are
added to the `away` note (`addToNote`, at most 8 lines), shown to the player as the *Meanwhile* card and gone when the next turn starts. The card is not part of the
conversation, so later turns do not carry it; the story still has what the characters did, through the records.

## What the story tracks (variables)

One system for feelings, injuries, debts, flags, reputations: a *variable* is declared once (`variable_defs`: kind number, flag or choice; what each value is
about: character, item, place or the world; bounds or words; default; who can tell it: public, private to the character, hidden; bands that give ranges of a
number words; optionally a baseline) and each subject has its own value (`variable_values`, only what differs is stored; the default stands otherwise). Feelings
(`valence`, `arousal`, `dominance`: -1 to 1, private, with a baseline temperament) are three built-in variables; there is no separate emotion table.

- **Declared** by the world (`variables.json`), by the story (the world author, `edit_world` `variables`, when the game master asks with `expand_world` reason
  `variable`: the same bar as for anything else: established, matters from here on, nothing tracked fits), and never by the keeper or the game master directly.
  At most 60.
- **Changed** by the game master in an outcome (`variable_changes`: `to`, `by` (stops at the bounds) or `baseline`), checked with the round and said back, and by the
  keeper from what the rounds show (`variable_changes` in `edit_records`). A value outside the bounds, a subject the variable does not apply to, or an unknown variable is
  refused with every reason.
- **Told** by audience: a character is told what is public and private to it about itself, and what is public about those with it; the game master the whole of it
  (the scene first, at most 14 lines); the keeper the non-default values and `list_variables`. Only values that differ from the default are told (or those marked `always`),
  at most eight for one subject.

## What the world does by itself (triggers)

Characters' plans, goals and engagements say what *they* want to do; a *trigger* is what the *world* does: a condition decided in code, and an effect. They are stored in `triggers` (definition,
status dormant/fired/failed/expired, fire count, last firing, what the condition was when last looked at, why it failed, origin world/story) and `trigger_notes` (the beats and cues a firing leaves, pending/done/lapsed).
The format is in `world-format.md`. Evaluation (`records/trigger-rules.ts`, `records/triggers.ts` in the state package) is deterministic and reads only the records: time, a character in a place, a variable,
an item held or lying somewhere, an event by tag, another trigger fired. A trigger fires on the rise of its condition; once by default; priority order; a cap per look; a seeded chance; a cooldown in story time;
an expiry. The effects of one trigger are applied in one transaction (an `edit` effect through the same checked path as the keeper's edits, its events sealed), and a failing one is marked failed.

- **Secret or scheduled and known.** A trigger with an `announce` (audience everyone / named characters / a place, text, `from`, `at`) is told while it has not fired: to the game master in the scene ("Known beforehand, still to come", with who knows) and to the characters who are in its audience ("What you know is coming", three soonest, with the date and how far off). Without `announce` it is a secret. Who learns of a secret event after it happens: an `edit` effect's event with `perceived_by: "everyone"`, or a cue to everyone or a place; the further spread of news is characters talking in play.
- **Otherwise, dormant triggers never reach a prompt.** Only what fired is told: to the game master in the scene at the start of a turn (what the world did while the player was away or since the last round, and the
  beats still to weave in), and in the result of `resolve_round` and `advance_time`; to characters as a cue in their brief, once. The game master reports the beats it wove in with `addressed` in `narrate`; a beat
  nobody takes up lapses after `triggers.beatTurns` turns, a cue after `triggers.cueTurns`.
- **The world author can make them in play** (`edit_world` `triggers`, only in authoring mode, when the game master asks with `expand_world` reason `trigger`): for a moment the story has set up that is
  bound to come and that records can show. They are checked against what exists, and a trigger may wait for one made in the same edit.
- **Settings**: `triggers.enabled`, `triggers.maxFires`, `triggers.beatTurns`, `triggers.cueTurns`.
- **Not built yet**: conditions judged by a model (a free-text statement; the old system's FACT and PACING modes), a condition on an engagement's state, forced actions, plot and script structure
  above single triggers (acts, branching storylines), the keeper or the game master making triggers, a debug view of dormant triggers, and catch-up of triggers aggregated over a long absence in real-time mode
  (they fire at the next look, once each).
