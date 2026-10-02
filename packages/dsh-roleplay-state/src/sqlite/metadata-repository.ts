import type { JsonValue, NewSession, SessionMetadata, WorldReference } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, CorruptDataError, NotFoundError } from '../errors.ts'
import type { MetadataRepository } from '../repositories.ts'

const SESSION_ID = 'session.id'
const SESSION_NAME = 'session.name'
const SESSION_CREATED_AT = 'session.created_at'
const SESSION_LAST_PLAYED_AT = 'session.last_played_at'
const SESSION_TURNS = 'session.turns'
const WORLD = 'world'
const RESERVED = new Set([SESSION_ID, SESSION_NAME, SESSION_CREATED_AT, SESSION_LAST_PLAYED_AT, SESSION_TURNS, WORLD])

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
    if (session.name.trim() === '') throw new RangeError('a session needs a name')
    return this.db.transaction(() => {
      if (this.read(SESSION_ID) !== undefined) throw new ConflictError('the session already has metadata')
      this.write(SESSION_ID, session.id)
      this.write(SESSION_NAME, session.name.trim())
      this.write(SESSION_CREATED_AT, this.clock().toISOString())
      this.write(SESSION_TURNS, '0')
      this.write(WORLD, JSON.stringify(session.world))
      return this.get()
    })
  }

  get(): SessionMetadata {
    const id = this.read(SESSION_ID)
    const name = this.read(SESSION_NAME)
    const createdAt = this.read(SESSION_CREATED_AT)
    const world = this.read(WORLD)
    if (id === undefined || name === undefined || createdAt === undefined || world === undefined) {
      throw new NotFoundError('the session has no metadata')
    }
    const lastPlayedAt = this.read(SESSION_LAST_PLAYED_AT)
    return {
      id,
      name,
      world: parseWorld(world),
      createdAt,
      ...(lastPlayedAt === undefined ? {} : { lastPlayedAt }),
      turns: this.turns(),
    }
  }

  setName(name: string): void {
    if (name.trim() === '') throw new RangeError('a session needs a name')
    this.write(SESSION_NAME, name.trim())
  }

  recordTurn(): SessionMetadata {
    return this.db.transaction(() => {
      this.write(SESSION_TURNS, String(this.turns() + 1))
      this.write(SESSION_LAST_PLAYED_AT, this.clock().toISOString())
      return this.get()
    })
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

  private turns(): number {
    const count = Number(this.read(SESSION_TURNS) ?? '0')
    if (!Number.isInteger(count) || count < 0) throw new CorruptDataError('metadata "session.turns" is not a count')
    return count
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
