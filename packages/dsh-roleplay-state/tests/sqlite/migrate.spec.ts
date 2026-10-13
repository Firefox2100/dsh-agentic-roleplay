import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHARACTER_CONTROLS, CHARACTER_KINDS, CHARACTER_ROLES, CHARACTER_TIERS,
  INTENT_HORIZONS, INTENT_STATUSES, INTENT_TYPES,
  SchemaError, migrationBackupPath, nodeSqliteDriver, openSessionStore,
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

  it('keeps the migrations of the 0.1.0 release as they were published', () => {
    const released: Record<number, string> = {
      1: '7fe43a969076c940ccc06f00a170800b59fae8108f4a6b3c26cc8c09e2c2941e',
      2: 'd4c45efd6a1262ea796bb1a291940e132f6fd281c53243474467e88a5346b53b',
      3: 'e475e2cb2785b71913ac24f2fce6a12aa86b5ec8af0a6ac6b4d0999fda4ddaa5',
      4: '9fdcd72cec06d5b81db418ea66c446660257103e8746b504e1b0e2d98ddb4dc7',
      5: '56d3b40c78d2010196563e64b72b501276ee87e70729690721b027c5abea7cdb',
      6: '50a6dbce0acfe194f2b11e09b58db626504f61681cb07ef26ac85f0ad5247cdf',
    }
    for (const [version, hash] of Object.entries(released)) {
      const migration = MIGRATIONS.find(candidate => candidate.version === Number(version))
      expect(migration, `migration ${version} is missing`).toBeDefined()
      expect(createHash('sha256').update(migration!.sql).digest('hex'), `migration ${version} was edited after release; add a new migration instead`).toBe(hash)
    }
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

  describe('before an upgrade', () => {
    function oldDatabase(version: number): string {
      const file = join(dir, 'session.sqlite')
      const db = nodeSqliteDriver.open(file)
      for (const migration of MIGRATIONS.slice(0, version)) db.exec(migration.sql)
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${version}`)
      db.close()
      return file
    }

    it('keeps a copy of the database as it was, once per old version', () => {
      const file = oldDatabase(3)
      openSessionStore(file, { vectors: false }).close()
      const backup = migrationBackupPath(file, 3)
      expect(existsSync(backup)).toBe(true)
      const copy = nodeSqliteDriver.open(backup)
      expect(inspect(copy).version).toBe(3)
      copy.close()
      writeFileSync(backup, 'kept')
      openSessionStore(file, { vectors: false }).close()
      expect(readFileSync(backup, 'utf8')).toBe('kept')
    })

    it('makes no copy when the schema is current', () => {
      const file = oldDatabase(LATEST_VERSION)
      openSessionStore(file, { vectors: false }).close()
      expect(existsSync(migrationBackupPath(file, LATEST_VERSION))).toBe(false)
    })

    it('does not upgrade a database that fails its integrity check', () => {
      const file = oldDatabase(2)
      const bytes = readFileSync(file)
      for (let index = 4096; index < bytes.length; index += 97) bytes[index] = 0xff
      writeFileSync(file, bytes)
      expect(() => openSessionStore(file, { vectors: false })).toThrow()
      expect(existsSync(migrationBackupPath(file, 2))).toBe(false)
    })
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
