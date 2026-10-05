import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, sessionFolder } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { archiveSession, restoreSession } from '../../../src/host/sessions/archive-session.ts'
import { SessionArchivedError, SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { listSessions } from '../../../src/host/sessions/list-sessions.ts'
import { openSession } from '../../../src/host/sessions/open-session.ts'
import { readStatus, writeStatus } from '../../../src/host/sessions/status.ts'

let root: string
let state: RoleplayState
let calls: string[]
let failure: Error | undefined
const sessionsDir = () => join(root, 'sessions')
const deps = () => ({
  agent: {
    archive: (id: string) => { calls.push(`archive ${id}`); return failure === undefined ? Promise.resolve() : Promise.reject(failure) },
    restore: (id: string) => { calls.push(`restore ${id}`); return failure === undefined ? Promise.resolve() : Promise.reject(failure) },
  },
  sessionsDir,
  now: () => new Date('2026-10-05T12:00:00Z'),
})
const make = (): string => state.createSession(sessionsDir(), { name: 'Night one', world: { id: 'blackwater', name: 'The Blackwater Observatory' } }).metadata.get().id

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'archive-session-'))
  calls = []
  failure = undefined
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('putting a session away', () => {
  it('hides and stops its chat, keeps everything, and marks it in the list', async () => {
    const id = make()
    await archiveSession(deps(), id)
    expect(calls).toEqual([`archive ${id}`])
    expect(readStatus(sessionFolder(sessionsDir(), id))).toEqual({ archivedAt: '2026-10-05T12:00:00.000Z' })
    expect(existsSync(join(sessionsDir(), id, 'session.sqlite'))).toBe(true)
    expect(listSessions({ state, sessionsDir }).sessions).toMatchObject([{ id, name: 'Night one', archivedAt: '2026-10-05T12:00:00.000Z' }])
  })

  it('is done once: putting it away again changes nothing, and a chat that cannot be put away leaves the session as it was', async () => {
    const id = make()
    await archiveSession(deps(), id)
    await archiveSession(deps(), id)
    expect(calls).toEqual([`archive ${id}`])
    const other = make()
    failure = new Error('the registry is down')
    await expect(archiveSession(deps(), other)).rejects.toThrow('the registry is down')
    expect(readStatus(sessionFolder(sessionsDir(), other))).toEqual({})
  })

  it('cannot be played until it is brought back; bringing it back shows its chat again and clears the mark', async () => {
    const id = make()
    const open = () => openSession({ state, agent: { ensure: (session: string) => Promise.resolve(`session-${session}`) }, sessionsDir }, id)
    await archiveSession(deps(), id)
    await expect(open()).rejects.toBeInstanceOf(SessionArchivedError)
    await restoreSession(deps(), id)
    expect(calls).toEqual([`archive ${id}`, `restore ${id}`])
    expect(readStatus(sessionFolder(sessionsDir(), id))).toEqual({})
    expect(await open()).toEqual({ id, chatSessionId: `session-${id}` })
    await restoreSession(deps(), id)
    expect(calls).toHaveLength(2)
  })

  it('refuses an id that names no session, and a status that is not one', async () => {
    await expect(archiveSession(deps(), 'nope')).rejects.toBeInstanceOf(SessionNotFoundError)
    await expect(restoreSession(deps(), '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(SessionNotFoundError)
    const id = make()
    writeStatus(sessionFolder(sessionsDir(), id), { archivedAt: 'x' })
    expect(readStatus(sessionFolder(sessionsDir(), id))).toEqual({ archivedAt: 'x' })
  })
})
