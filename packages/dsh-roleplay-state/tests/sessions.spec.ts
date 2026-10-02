import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError, NotFoundError, SESSION_DATABASE_FILE,
  createSession, deleteSession, isSessionId, listSessions, openSession, sessionDatabase, sessionFolder,
  type SessionInit,
} from '../src/index.ts'
import { newCharacter } from './helpers.ts'

let dir: string
let sessionsDir: string

const init: SessionInit = { name: 'First night', world: { id: 'blackwater', name: 'The Blackwater Observatory' } }
const ID = '3f2b8c1e-1c1a-4a4e-9d0f-2d8f9b6a7c11'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'state-sessions-'))
  sessionsDir = join(dir, 'sessions')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('session folders', () => {
  it('accepts only UUID v4 ids', () => {
    expect(isSessionId(ID)).toBe(true)
    for (const bad of ['', 'abc', '../escape', `${ID}/..`, ID.toUpperCase(), ID.replace('-4a', '-1a'), `${ID} `]) {
      expect(isSessionId(bad), bad).toBe(false)
    }
  })

  it('keeps a session at <sessions folder>/<id>/session.sqlite', () => {
    expect(sessionFolder(sessionsDir, ID)).toBe(join(sessionsDir, ID))
    expect(sessionDatabase(sessionsDir, ID)).toBe(join(sessionsDir, ID, SESSION_DATABASE_FILE))
  })

  it('refuses an id that could leave the sessions folder', () => {
    expect(() => sessionFolder(sessionsDir, '../outside')).toThrow(RangeError)
    expect(() => openSession(sessionsDir, '../outside')).toThrow(RangeError)
    expect(() => deleteSession(sessionsDir, '../outside')).toThrow(RangeError)
    expect(() => createSession(sessionsDir, { ...init, id: '../outside' })).toThrow(RangeError)
  })
})

describe('createSession', () => {
  it('creates the folder and the database, generating an id', async () => {
    const store = createSession(sessionsDir, init)
    const { id } = store.metadata.get()
    expect(isSessionId(id)).toBe(true)
    expect(await readdir(join(sessionsDir, id))).toEqual([SESSION_DATABASE_FILE])
    expect(store.metadata.get()).toMatchObject({ name: 'First night', world: { id: 'blackwater' } })
    store.close()
  })

  it('uses the id it is given, and the session can be opened again', () => {
    createSession(sessionsDir, { ...init, id: ID }).close()
    const store = openSession(sessionsDir, ID)
    expect(store.metadata.get().id).toBe(ID)
    store.close()
  })

  it('refuses an id that is taken and leaves that session alone', () => {
    const first = createSession(sessionsDir, { ...init, id: ID })
    first.characters.add(newCharacter())
    first.close()
    expect(() => createSession(sessionsDir, { ...init, id: ID })).toThrow(ConflictError)
    const reopened = openSession(sessionsDir, ID)
    expect(reopened.characters.list()).toHaveLength(1)
    reopened.close()
  })

  it('leaves nothing behind when the database cannot be created', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => createSession(sessionsDir, {
      ...init, id: ID, world: { id: 'w', name: 'W', extra: circular as never },
    })).toThrow()
    expect(await readdir(sessionsDir)).toEqual([])
  })

  it('creates the sessions folder when it does not exist', async () => {
    createSession(join(dir, 'deeper', 'sessions'), init).close()
    expect((await stat(join(dir, 'deeper', 'sessions'))).isDirectory()).toBe(true)
  })
})

describe('openSession and deleteSession', () => {
  it('does not open a session that is not there', () => {
    expect(() => openSession(sessionsDir, ID)).toThrow(NotFoundError)
  })

  it('removes a session with everything in its folder, and only that session', async () => {
    const other = '9a1c7e2d-5b3f-4c8a-8e1d-6f2b3c4d5e6f'
    createSession(sessionsDir, { ...init, id: ID }).close()
    createSession(sessionsDir, { ...init, id: other }).close()
    deleteSession(sessionsDir, ID)
    expect(await readdir(sessionsDir)).toEqual([other])
    deleteSession(sessionsDir, ID)
  })
})

describe('listSessions', () => {
  const second = '9a1c7e2d-5b3f-4c8a-8e1d-6f2b3c4d5e6f'

  it('has none for a sessions folder that does not exist or is empty', async () => {
    expect(listSessions(sessionsDir)).toEqual({ sessions: [], problems: [] })
    await mkdir(sessionsDir)
    expect(listSessions(sessionsDir)).toEqual({ sessions: [], problems: [] })
  })

  it('reads the metadata of every session', () => {
    createSession(sessionsDir, { ...init, id: ID, name: 'One' }).close()
    const other = createSession(sessionsDir, { ...init, id: second, name: 'Two' })
    other.metadata.recordTurn()
    other.close()
    const { sessions, problems } = listSessions(sessionsDir)
    expect(problems).toEqual([])
    expect(sessions.map(session => [session.id, session.name, session.turns]).sort()).toEqual([[ID, 'One', 0], [second, 'Two', 1]].sort())
    expect(sessions.find(session => session.id === second)?.lastPlayedAt).toBeDefined()
  })

  it('ignores anything not named like a session', async () => {
    createSession(sessionsDir, { ...init, id: ID }).close()
    await mkdir(join(sessionsDir, 'not-a-session'))
    await writeFile(join(sessionsDir, 'notes.txt'), 'x')
    expect(listSessions(sessionsDir).sessions.map(session => session.id)).toEqual([ID])
  })

  it('reports a session that cannot be read and still lists the others', async () => {
    createSession(sessionsDir, { ...init, id: ID }).close()
    await mkdir(join(sessionsDir, second))
    await writeFile(join(sessionsDir, second, 'session.sqlite'), 'not a database')
    const { sessions, problems } = listSessions(sessionsDir)
    expect(sessions.map(session => session.id)).toEqual([ID])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.id).toBe(second)
  })

  it('uses a connection that is already open instead of opening the file again', () => {
    const open = createSession(sessionsDir, { ...init, id: ID })
    open.metadata.setName('Changed while open')
    const { sessions } = listSessions(sessionsDir, {}, id => (id === ID ? open : undefined))
    expect(sessions[0]?.name).toBe('Changed while open')
    open.close()
  })
})
