import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError, NotFoundError, SCHEMA_VERSION, createSessionStore, nodeSqliteDriver, openSessionStore,
  type NewSession,
} from '../../src/index.ts'
import { newCharacter, newIntent, steppingClock } from '../helpers.ts'

let dir: string
let file: string

const session: NewSession = { id: '3f2b8c1e-1c1a-4a4e-9d0f-2d8f9b6a7c11', world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' } }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'state-store-'))
  file = join(dir, 'session.sqlite')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('session store', () => {
  it('keeps a session in one file that survives closing and reopening', () => {
    const created = createSessionStore(file, session, { clock: steppingClock() })
    const { id } = created.characters.add(newCharacter())
    created.characterStates.create(id, { publicState: 'a', innerState: 'b', activity: 'c' })
    created.intents.add(id, newIntent())
    created.close()

    const reopened = openSessionStore(file)
    expect(reopened.metadata.get()).toMatchObject(session)
    expect(reopened.characters.findByName('the mayor')).toHaveLength(1)
    expect(reopened.characterStates.get(id)?.publicState).toBe('a')
    expect(reopened.intents.list(id)).toHaveLength(1)
    reopened.close()
  })

  it('leaves nothing but the database file behind', async () => {
    createSessionStore(file, session).close()
    expect(await readdir(dir)).toEqual(['session.sqlite'])
  })

  it('records the schema version in the file', () => {
    createSessionStore(file, session).close()
    const db = nodeSqliteDriver.open(file)
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('refuses to create a session where one exists, and keeps the existing one', () => {
    createSessionStore(file, session).close()
    expect(() => createSessionStore(file, { ...session, id: 'other' })).toThrow(ConflictError)
    const reopened = openSessionStore(file)
    expect(reopened.metadata.get().id).toBe(session.id)
    reopened.close()
  })

  it('does not create a file when opening a session that is not there', () => {
    expect(() => openSessionStore(join(dir, 'missing.sqlite'))).toThrow(NotFoundError)
    expect(() => openSessionStore(join(dir, 'missing.sqlite'))).toThrow(/no session database/)
  })

  it('fails to create a session in a folder that does not exist', () => {
    expect(() => createSessionStore(join(dir, 'nope', 'session.sqlite'), session)).toThrow()
  })

  it('opens an older schema and brings it up to date', () => {
    createSessionStore(file, session).close()
    const db = nodeSqliteDriver.open(file)
    db.exec('PRAGMA user_version = 0')
    db.exec('PRAGMA user_version = 1')
    db.close()
    openSessionStore(file).close()
  })

  it('works in write-ahead mode too', async () => {
    const store = createSessionStore(file, session, { journalMode: 'wal' })
    store.characters.add(newCharacter())
    store.close()
    const reopened = openSessionStore(file, { journalMode: 'wal' })
    expect(reopened.characters.list()).toHaveLength(1)
    reopened.close()
  })

  describe('transaction', () => {
    it('keeps the work of several repositories together or not at all', async () => {
      await mkdir(dir, { recursive: true })
      const store = createSessionStore(file, session)
      expect(() => store.transaction(() => {
        const { id } = store.characters.add(newCharacter())
        store.characterStates.create(id, { publicState: '', innerState: '', activity: '' })
        store.intents.add(id, newIntent({ priority: 5 }))
      })).toThrow()
      expect(store.characters.list()).toEqual([])

      const id = store.transaction(() => {
        const character = store.characters.add(newCharacter())
        store.characterStates.create(character.id, { publicState: 'x', innerState: '', activity: '' })
        store.intents.add(character.id, newIntent())
        return character.id
      })
      expect(store.characterStates.get(id)?.publicState).toBe('x')
      expect(store.intents.list(id)).toHaveLength(1)
      store.close()
    })
  })
})
