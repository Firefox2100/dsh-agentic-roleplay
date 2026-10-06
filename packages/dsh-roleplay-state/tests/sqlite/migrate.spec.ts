import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHARACTER_CONTROLS, CHARACTER_KINDS, CHARACTER_ROLES, CHARACTER_TIERS,
  INTENT_HORIZONS, INTENT_STATUSES, INTENT_TYPES,
  SchemaError, nodeSqliteDriver, openSessionStore,
} from '../../src/index.ts'
import { inspect, migrate } from '../../src/sqlite/migrate.ts'
import { APPLICATION_ID, LATEST_VERSION, MIGRATIONS } from '../../src/sqlite/schema.ts'

let dir: string

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'state-migrate-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('migrate', () => {
  it('builds the schema on an empty database and marks it as ours', () => {
    const db = nodeSqliteDriver.open(':memory:')
    migrate(db)
    expect(inspect(db)).toMatchObject({ version: LATEST_VERSION, applicationId: APPLICATION_ID, empty: false })
    migrate(db)
    expect(inspect(db).version).toBe(LATEST_VERSION)
    db.close()
  })

  it('numbers its migrations consecutively from 1', () => {
    expect(MIGRATIONS.map(migration => migration.version)).toEqual(MIGRATIONS.map((_, index) => index + 1))
  })

  it('adds visual identities to an existing version 1 session', () => {
    const db = nodeSqliteDriver.open(':memory:')
    db.exec(MIGRATIONS[0]!.sql)
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 1')
    migrate(db)
    expect(inspect(db).version).toBe(LATEST_VERSION)
    expect(db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visual_identities'")?.name).toBe('visual_identities')
    db.close()
  })

  it('adds entity knowledge to an existing version 2 session', () => {
    const db = nodeSqliteDriver.open(':memory:')
    db.exec(MIGRATIONS[0]!.sql)
    db.exec(MIGRATIONS[1]!.sql)
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 2')
    migrate(db)
    expect(inspect(db).version).toBe(LATEST_VERSION)
    expect(db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entity_knowledge'")?.name).toBe('entity_knowledge')
    db.close()
  })

  it('adds factions to an existing version 3 session', () => {
    const db = nodeSqliteDriver.open(':memory:')
    for (const migration of MIGRATIONS.slice(0, 3)) db.exec(migration.sql)
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 3')
    migrate(db)
    expect(inspect(db).version).toBe(LATEST_VERSION)
    expect(db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factions'")?.name).toBe('factions')
    expect(db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'faction_memberships'")?.name).toBe('faction_memberships')
    db.close()
  })

  it('refuses a database that holds something else', () => {
    const db = nodeSqliteDriver.open(':memory:')
    db.exec('CREATE TABLE other (x TEXT)')
    expect(() => migrate(db)).toThrow(SchemaError)
    db.close()
  })

  it('refuses a database from a newer version', () => {
    const db = nodeSqliteDriver.open(':memory:')
    migrate(db)
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`)
    expect(() => migrate(db)).toThrow(/newer|understands up to/)
    db.close()
  })

  it('refuses a versioned database with a different application id', () => {
    const db = nodeSqliteDriver.open(':memory:')
    db.exec('CREATE TABLE other (x TEXT)')
    db.exec('PRAGMA user_version = 1')
    expect(() => migrate(db)).toThrow(SchemaError)
    db.close()
  })

  it('does not open an unrelated database file as a session', () => {
    const file = join(dir, 'other.sqlite')
    const other = nodeSqliteDriver.open(file)
    other.exec('CREATE TABLE notes (x TEXT)')
    other.close()
    expect(() => openSessionStore(file)).toThrow(SchemaError)
    const empty = join(dir, 'empty.sqlite')
    nodeSqliteDriver.open(empty).close()
    expect(() => openSessionStore(empty)).toThrow(SchemaError)
  })
})

describe('schema', () => {
  /** The migration spells its enumerations out, so this keeps them equal to the model's. */
  it('allows exactly the values of the model enumerations', () => {
    const db = nodeSqliteDriver.open(':memory:')
    migrate(db)
    const sql = db.get<{ sql: string }>("SELECT group_concat(sql, ' ') AS sql FROM sqlite_master WHERE type = 'table'")?.sql ?? ''
    const listed = (column: string): string[] => {
      const match = new RegExp(`${column} TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(sql)
      return (match?.[1] ?? '').split(',').map(value => value.trim().replaceAll("'", ''))
    }
    expect(listed('kind')).toEqual([...CHARACTER_KINDS])
    expect(listed('tier')).toEqual([...CHARACTER_TIERS])
    expect(listed('role')).toEqual([...CHARACTER_ROLES])
    expect(listed('control')).toEqual([...CHARACTER_CONTROLS])
    expect(listed('type')).toEqual([...INTENT_TYPES])
    expect(listed('status')).toEqual([...INTENT_STATUSES])
    expect(listed('horizon')).toEqual([...INTENT_HORIZONS])
    db.close()
  })

  it('removes a character\'s rows with it', () => {
    const db = nodeSqliteDriver.open(':memory:')
    migrate(db)
    db.run(
      `INSERT INTO characters (name, name_key, kind, tier, role, control, created_at)
       VALUES ('A', 'a', 'person', 'principal', 'npc', 'agent', 'now')`,
    )
    db.run("INSERT INTO character_aliases (character_id, position, alias, alias_key) VALUES (1, 0, 'x', 'x')")
    db.run("INSERT INTO character_state (character_id, updated_at) VALUES (1, 'now')")
    db.run(
      `INSERT INTO intents (character_id, type, name, status, horizon, priority, urgency, created_at, updated_at)
       VALUES (1, 'need', 'n', 'active', 'short', 0.5, 0.5, 'now', 'now')`,
    )
    db.run('DELETE FROM characters WHERE id = 1')
    for (const table of ['character_aliases', 'character_state', 'intents']) {
      expect(db.get<{ count: number }>(`SELECT count(*) AS count FROM ${table}`)?.count, table).toBe(0)
    }
    db.close()
  })
})
