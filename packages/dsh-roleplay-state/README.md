# dsh-roleplay-state

The state of one roleplay session, stored in one SQLite database and reached
through repositories over canonical models. Nothing here knows about the agent,
the UI or how a session is started; a plugin that exposes the repositories as
tools can be built on top.

Requires Node 22.19 or later (it uses the built-in `node:sqlite`).

```ts
import { createSessionStore, openSessionStore } from 'dsh-roleplay-state'

// The folder must exist. The file holds everything about the session.
const store = createSessionStore('sessions/3f2b…/session.sqlite', {
  id: '3f2b…',
  title: 'First night',
  world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' },
})

store.transaction(() => {
  const mayor = store.characters.add({ name: 'Eleanor Graves', /* … */ control: 'agent' })
  store.characterStates.create(mayor.id, { publicState: '…', innerState: '…', activity: '…' })
  store.intents.add(mayor.id, { type: 'agenda', name: '…', /* … */ })
})

store.characters.findByName('the mayor')          // by name or alias, ignoring case
store.characterStates.update(1, { activity: 'looking for the key' }, { expectedVersion: 3 })
store.close()

const again = openSessionStore('sessions/3f2b…/session.sqlite') // migrates an older schema
```

## Layers

| Layer | What it is |
|---|---|
| Canonical model | The types in `dsh-roleplay-model` (re-exported here): `Character`, `CharacterState`, `CharacterIntent`, `SessionMetadata`, … |
| Repositories | `MetadataRepository`, `CharacterRepository`, `CharacterStateRepository`, `IntentRepository`: the only access to the data. They take and return canonical models and throw the errors below. |
| SQLite implementation | Maps rows to models and back; the only place that knows tables and SQL. |
| Driver | `SqlDriver` / `SqlDatabase`: the few operations the implementation needs (`exec`, `run`, `get`, `all`, `transaction`). `nodeSqliteDriver` is built on `node:sqlite`; pass another driver in the options to use a different SQLite library. |

Everything is synchronous, as the embedded SQLite libraries are.

## The session

A session is the folder `sessions/<uuid>/` with its database `session.sqlite`.
The database is the only file the state needs; it uses a rollback journal by
default, so it stays a single file that can be copied or archived (`journalMode:
'wal'` is available).

The world itself is not stored. `metadata` keeps a **world reference**: the
world's stable id (the `id` in its `world.json`, not a database id), its name,
and optionally a version, a fingerprint of the content the session was started
from, its source, and free-form `extra` fields. It is saved as one document, so
provenance can grow without a schema change.

Characters have session-local integer ids. `source_id` keeps the provisional id
the character had in the world, so a session can be traced back to its world;
characters created during play have none.

## Schema (version 1)

| Table | Holds |
|---|---|
| `metadata` | Key/value rows: `session.id`, `session.title`, `session.created_at`, `world` (JSON), plus free-form namespaced entries. |
| `characters` | The definition: name, age, gender, pronouns, kind, tier, role, summary, personality, background, appearance, speech, and `control` (`player` or `agent`, chosen for the session). `source_id` is unique. |
| `character_aliases` | One row per alias, in order, with a case-folded key for lookup. |
| `character_state` | The state that changes in play: public state, inner state, activity, `version`, `updated_at`. One row per character. |
| `character_emotion` | Optional baseline and immediate valence/arousal/dominance of a state. |
| `intents` | A character's intents: type, name, description, status, horizon, priority, urgency, plan, open threads, constraints, deadline. |

Deleting a character deletes everything that belongs to it. The tables are
`STRICT`, enumerations and ranges are `CHECK` constraints, and foreign keys are
enforced. The file records its schema version in `user_version` and carries an
application id, so a file that is not a session database is refused.

## Changing the schema

Migrations are applied in order when a session is opened and are never edited
once released: a change is a new entry in `src/sqlite/schema.ts`. Before the
first release the schema is still being shaped, and migration 1 is edited in
place. A database from
a newer version is refused rather than damaged. The migration spells its
enumerations out, and a test keeps them equal to the model's.

## Errors

| Error | When |
|---|---|
| `NotFoundError` | A row, character or session file does not exist. |
| `ConflictError` | A repeated `source_id`, a state created twice, a stale `expectedVersion`, or creating a session where one exists. |
| `InvalidValueError` | A value is outside what the schema allows. |
| `SchemaError` | The file is not a session database, or comes from a newer version. |
| `CorruptDataError` | Stored data cannot be read back as a model. |
