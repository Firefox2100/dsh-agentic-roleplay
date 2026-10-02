import type { JsonValue, NewSession, SessionMetadata, WorldReference } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, CorruptDataError, NotFoundError } from '../errors.ts'
import type { MetadataRepository } from '../repositories.ts'

const SESSION_ID = 'session.id'
const SESSION_TITLE = 'session.title'
const SESSION_CREATED_AT = 'session.created_at'
const WORLD = 'world'
const RESERVED = new Set([SESSION_ID, SESSION_TITLE, SESSION_CREATED_AT, WORLD])

function parseJson(text: string, key: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch (error) {
    throw new CorruptDataError(`metadata "${key}" is not valid JSON`, { cause: error })
  }
}

function parseWorld(text: string): WorldReference {
  const value = parseJson(text, WORLD)
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new CorruptDataError('metadata "world" is not a world reference')
  }
  return value as unknown as WorldReference
}

export class SqliteMetadataRepository implements MetadataRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  /** Write the session's identity; only the store does this, once, when the database is created. */
  create(session: NewSession): SessionMetadata {
    if (session.id.trim() === '') throw new RangeError('a session needs an id')
    return this.db.transaction(() => {
      if (this.read(SESSION_ID) !== undefined) throw new ConflictError('the session already has metadata')
      this.write(SESSION_ID, session.id)
      this.write(SESSION_CREATED_AT, this.clock().toISOString())
      if (session.title !== undefined) this.write(SESSION_TITLE, session.title)
      this.write(WORLD, JSON.stringify(session.world))
      return this.get()
    })
  }

  get(): SessionMetadata {
    const id = this.read(SESSION_ID)
    const createdAt = this.read(SESSION_CREATED_AT)
    const world = this.read(WORLD)
    if (id === undefined || createdAt === undefined || world === undefined) throw new NotFoundError('the session has no metadata')
    const title = this.read(SESSION_TITLE)
    return { id, ...(title === undefined ? {} : { title }), createdAt, world: parseWorld(world) }
  }

  setTitle(title: string | null): void {
    if (title === null) this.db.run('DELETE FROM metadata WHERE key = ?', [SESSION_TITLE])
    else this.write(SESSION_TITLE, title)
  }

  setWorld(world: WorldReference): void {
    this.write(WORLD, JSON.stringify(world))
  }

  getValue(key: string): JsonValue | undefined {
    this.assertFree(key)
    const text = this.read(key)
    return text === undefined ? undefined : parseJson(text, key)
  }

  setValue(key: string, value: JsonValue): void {
    this.assertFree(key)
    this.write(key, JSON.stringify(value))
  }

  deleteValue(key: string): boolean {
    this.assertFree(key)
    return this.db.run('DELETE FROM metadata WHERE key = ?', [key]).changes > 0
  }

  private assertFree(key: string): void {
    if (RESERVED.has(key)) throw new RangeError(`"${key}" is reserved for the session`)
  }

  private read(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM metadata WHERE key = ?', [key])?.value
  }

  private write(key: string, value: string): void {
    this.db.run('INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
  }
}
