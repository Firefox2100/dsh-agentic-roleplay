import { existsSync } from 'node:fs'
import type { NewSession } from 'dsh-roleplay-model'
import { systemClock, type Clock } from './clock.ts'
import { nodeSqliteDriver } from './driver/node-sqlite.ts'
import type { OpenOptions, SqlDatabase, SqlDriver } from './driver/types.ts'
import { ConflictError, NotFoundError, SchemaError } from './errors.ts'
import type { CharacterRepository, CharacterStateRepository, IntentRepository, MetadataRepository } from './repositories.ts'
import { SqliteCharacterRepository } from './sqlite/character-repository.ts'
import { SqliteIntentRepository } from './sqlite/intent-repository.ts'
import { SqliteMetadataRepository } from './sqlite/metadata-repository.ts'
import { inspect, migrate } from './sqlite/migrate.ts'
import { APPLICATION_ID, LATEST_VERSION } from './sqlite/schema.ts'
import { SqliteCharacterStateRepository } from './sqlite/state-repository.ts'

export interface StoreOptions extends OpenOptions {
  /** Defaults to the driver on Node's built-in SQLite. */
  driver?: SqlDriver
  /** Supplies the time stamped on rows; defaults to the system clock. */
  clock?: Clock
}

/** One session: everything stored about it, reached through repositories. */
export interface SessionStore {
  readonly metadata: MetadataRepository
  readonly characters: CharacterRepository
  readonly characterStates: CharacterStateRepository
  readonly intents: IntentRepository
  /** Run `fn` atomically across the repositories; see {@link SqlDatabase.transaction}. */
  transaction<T>(fn: () => T): T
  close(): void
}

class SqliteSessionStore implements SessionStore {
  readonly metadata: SqliteMetadataRepository
  readonly characters: CharacterRepository
  readonly characterStates: CharacterStateRepository
  readonly intents: IntentRepository

  constructor(private readonly db: SqlDatabase, clock: Clock) {
    this.metadata = new SqliteMetadataRepository(db, clock)
    this.characters = new SqliteCharacterRepository(db, clock)
    this.characterStates = new SqliteCharacterStateRepository(db, clock)
    this.intents = new SqliteIntentRepository(db, clock)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)
  }

  close(): void {
    this.db.close()
  }
}

function connect(location: string, options: StoreOptions): SqlDatabase {
  const { driver = nodeSqliteDriver, clock: _clock, ...open } = options
  return driver.open(location, open)
}

/**
 * Create the database of a new session at `location` (the file must not hold a
 * session yet, and its folder must exist).
 * @throws {ConflictError} when the location already holds a session database.
 */
export function createSessionStore(location: string, session: NewSession, options: StoreOptions = {}): SessionStore {
  const db = connect(location, options)
  try {
    if (inspect(db).version > 0) throw new ConflictError(`${location} already holds a session database`)
    migrate(db)
    const store = new SqliteSessionStore(db, options.clock ?? systemClock)
    store.metadata.create(session)
    return store
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Open the database of an existing session, bringing an older schema up to date.
 * @throws {NotFoundError} when there is no file at `location`.
 * @throws {SchemaError} when the file is not a session database, or is from a newer version.
 */
export function openSessionStore(location: string, options: StoreOptions = {}): SessionStore {
  if (location !== ':memory:' && !existsSync(location)) throw new NotFoundError(`no session database at ${location}`)
  const db = connect(location, options)
  try {
    const state = inspect(db)
    if (state.version === 0 || state.applicationId !== APPLICATION_ID) throw new SchemaError(`${location} is not a session database`)
    migrate(db)
    return new SqliteSessionStore(db, options.clock ?? systemClock)
  } catch (error) {
    db.close()
    throw error
  }
}

export { LATEST_VERSION as SCHEMA_VERSION }
