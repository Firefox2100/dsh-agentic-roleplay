# dsh-roleplay-state

A DeepSeek Harness plugin that keeps the state of roleplay sessions: one SQLite
database per session, reached through repositories over canonical models. It
does no orchestration and has no UI, so it can be installed on its own to get a
roleplay database and state management without the rest of the roleplay bundle.
Other plugins use it through the `roleplayState` service. Model-facing tools
will be added to the same plugin later.

Requires DSH 0.2 and Node 22.19 or later (it uses the built-in `node:sqlite`).

```sh
dsh plugin --profile <name> add dsh-roleplay-state
```

## Using it from another plugin

```ts
import type {} from 'dsh-roleplay-state'            // types `ctx.roleplayState`
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['roleplayState']

export function apply(ctx: Context) {
  // Creates sessions/<uuid>/session.sqlite and opens it.
  const session = ctx.roleplayState.createSession('/path/to/sessions', {
    name: 'First night',
    world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' },
  })

  session.transaction(() => {
    const mayor = session.characters.add({ name: 'Eleanor Graves', /* … */ control: 'agent' })
    session.characterStates.create(mayor.id, { publicState: '…', innerState: '…', activity: '…' })
    session.intents.add(mayor.id, { type: 'agenda', name: '…', /* … */ })
  })

  session.characters.findByName('the mayor')       // by name or alias, ignoring case
  session.characterStates.update(1, { activity: 'looking for the key' }, { expectedVersion: 3 })
}
```

The service creates and opens sessions under a sessions folder you give it,
shares one connection per session, and closes them all when the plugin unloads:

| Method | Does |
|---|---|
| `createSession(sessionsDir, init)` | Creates the session folder and database and returns its repositories. The id is generated (UUID v4) unless given. Nothing is left behind if it fails. |
| `openSession(sessionsDir, id)` | Returns the repositories of an existing session. |
| `listSessions(sessionsDir)` | The metadata of every session under the folder (name, world, creation time, last played time, turns). A session that cannot be read is reported in `problems`, not thrown. |
| `closeSession(sessionsDir, id)` | Releases the connection; opening again reconnects. |
| `deleteSession(sessionsDir, id)` | Closes the session and removes its folder. |

Session ids become folder names, so only a UUID v4 is accepted. The package also
exports the same operations as plain functions (`createSession`, `openSession`,
`createSessionStore`, …) for code that does not run inside DSH, such as tests.

## The records API and the model-facing tools

The package owns how a story is remembered, not only where it is stored:

- `session.edit(edit)` changes the story's records (character states, events with who took each in, beliefs, threads) together or not at all. It checks the whole edit first and throws `InvalidEditError` naming every problem, so a model's mistakes can be reported back to it. `parseRecordsEdit(json)` reads the wire format models write (snake_case) and `recordsEditSchema({ characters, changes })` is its JSON schema, for a model's structured output or a tool's parameters.
- `session.records(scope)` reads the records back in the same wire format.
- `session.recall({ characterId, situation, turn, policy })` is what a character is reminded of: events it took in and things it believes, by who the situation mentions, shared words and tags, importance and recency; with `policy.flaky` the older and less important are told as faded or vague, or are gone. It counts what it brings back as recalled, which makes it last longer.
- `session.recallStored(query, { queryVector? })` adds the session's search index to the cues: texts that match the situation by words and, with the vector of the situation, by meaning. `session.searchEvents({ text, vector?, fromTurn, toTurn, minImportance, limit })` finds what happened by the same two searches, merged by reciprocal rank.
- `session.recallRanked(query, signal, { queryVector? })` is the call for anything that reminds a character of something: `recall`, ranked by meaning when a plugin has registered a ranker with `roleplayState.rankMemories(ranker)` (an embedding model, a reranker; see `docs/capabilities.md`). `session.recallCandidates(query)` gives what could be recalled, with the text to match, for a ranker.
- `roleplayState.bind(resolver)` tells the tools which roleplay session an agent works in (the plugin that runs the agents supplies it, with the turn being played and the memory policy).

Tools registered with the DSH tool registry (`defineTool`, typed output, honoring the call's `signal`), resolved through that binding: `list_characters`, `get_character`, `search_events`, `recall_memories`, `list_threads`, and, only when the plugin is configured with `writeTools: true`, `update_character_state`, `record_event`, `remember`, `open_thread`, `resolve_thread`. They fail with a plain message for an agent that works in no roleplay session. Characters and other one-shot sub-agents see none of them (they are started with no tools).

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `journalMode` | `delete` | `delete` keeps each session in a single file that can be copied; `wal` allows readers during writes. |
| `writeTools` | `false` | Also register the model-facing tools that change the records. Leave off where another agent is responsible for them. |

## Layers

| Layer | What it is |
|---|---|
| Canonical model | The types in `dsh-roleplay-model` (re-exported here): `Character`, `CharacterState`, `CharacterIntent`, `SessionMetadata`, … |
| Repositories | `MetadataRepository`, `CharacterRepository`, `CharacterStateRepository`, `IntentRepository`: the only access to the data. They take and return canonical models and throw the errors below. |
| SQLite implementation | Maps rows to models and back; the only place that knows tables and SQL. |
| Driver | `SqlDriver` / `SqlDatabase`: the few operations the implementation needs (`exec`, `run`, `get`, `all`, `transaction`). `nodeSqliteDriver` is built on `node:sqlite`. |

Everything is synchronous, as the embedded SQLite libraries are.

## The session

A session is the folder `sessions/<uuid>/` with its database `session.sqlite`.
The database is the only file the state needs; with the default journal mode it
stays a single file that can be copied or archived.

The world itself is not stored. `metadata` keeps a **world reference**: the
world's stable id (the `id` in its `world.json`, not a database id), its name,
and optionally a version, a fingerprint of the content the session was started
from, its source, and free-form `extra` fields. It is saved as one document, so
provenance can grow without a schema change.

The metadata also carries what a list of sessions shows: the session's `name`
(chosen when it is created), its creation time, the time of the last play
(absent until a turn has been played) and the number of turns played. Whatever
plays a turn calls `metadata.recordTurn()`, which counts it and sets the time.

Characters have session-local integer ids. `source_id` keeps the id the
character had in the world, so a session can be traced back to its world;
characters created during play have none.

## Schema (version 1)

| Table | Holds |
|---|---|
| `metadata` | Key/value rows: `session.id`, `session.name`, `session.created_at`, `session.last_played_at`, `session.turns`, `world` (JSON), plus free-form namespaced entries. |
| `characters` | The definition: name, age, gender, pronouns, kind, tier, role, summary, personality, background, appearance, speech, and `control` (`player` or `agent`, chosen for the session). `source_id` is unique. |
| `character_aliases` | One row per alias, in order, with a case-folded key for lookup. |
| `character_state` | The state that changes in play: public state, inner state, activity, `version`, `updated_at`. One row per character. |
| `character_emotion` | Optional baseline and immediate valence/arousal/dominance of a state. |
| `intents` | A character's intents: type, name, description, status, horizon, priority, urgency, plan, open threads, constraints, deadline. |
| `locations`, `exits`, `placements` | Places (with features), the ways between them (one direction each, `open` / `locked` / `blocked`, optional travel seconds) and where things stand (a character: place, position, feature; the same table will place items). `session.planMove` / `session.move` move a character over open exits only (`InvalidMoveError` names every reason); the edit wire format can make places, change exits and move characters. |
| `events` | What objectively happened: turn, round, text, importance (1 to 5), tags. `event_involves` lists the characters an event is about. Events are immutable: a draft until `sealed`, final afterwards (`events.seal()`); updating or removing a sealed one throws `ConflictError`. |
| `perceptions` | What one character took in of an event, in its own terms: mode (witnessed, heard, told, inferred), content, a gist for when it fades, an accuracy label (never shown to the character), and how often it was recalled. One per character and event. |
| `memories` | What a character believes or knows beyond single events: kind (belief, relationship, knowledge), text, the characters it is about, importance, the turn it formed in. |
| `story_threads` | Things not settled yet: promises, mysteries, goals; open or resolved. |
| `summaries` | The account of the story for the conversation's head: digests of recent turns and chapters of older ones, each with the turns it covers. |
| `recall_items`, `recall_fts`, `recall_vocab`, `recall_vec` | The search index: one row per perception, memory and event, indexed by words (FTS5) and, once vectors are stored, by meaning (sqlite-vec, cosine, partitioned by character). `store.recallIndex` lists the texts without a vector (`pending`), stores vectors (`store`, which fixes the model and dimensions of the session's vectors) and searches (`lexical`, `vector`). Vector support is optional: without the extension everything but `vector` works. |
| `pending_commits` | Recorded rounds whose events and memories are not written yet, kept so that a failure loses nothing. |

Events are the ground truth; perceptions (which stay revisable: `updatePerception`, `addPerception`), memories and summaries are derived from them and can be rebuilt. The repositories are `events`, `memories`, `threads`, `summaries` and `pendingCommits` next to the ones for characters.

Deleting a character deletes everything that belongs to it. The tables are
`STRICT`, enumerations and ranges are `CHECK` constraints, and foreign keys are
enforced. The file records its schema version in `user_version` and carries an
application id, so a file that is not a session database is refused.

## Changing the schema

Migrations are applied in order when a session is opened and are never edited
once released: a change is a new entry in `src/sqlite/schema.ts`. Before the
first release the schema is still being shaped, and migration 1 is edited in
place. A database from a newer version is refused rather than damaged.

## Errors

| Error | When |
|---|---|
| `NotFoundError` | A row, character or session file does not exist. |
| `ConflictError` | A repeated `source_id`, a state created twice, a stale `expectedVersion`, or creating a session where one exists. |
| `InvalidValueError` | A value is outside what the schema allows. |
| `SchemaError` | The file is not a session database, or comes from a newer version. |
| `CorruptDataError` | Stored data cannot be read back as a model. |
