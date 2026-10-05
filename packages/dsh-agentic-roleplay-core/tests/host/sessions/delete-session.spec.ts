import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteSession } from '../../../src/host/sessions/delete-session.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'

let root: string
let state: RoleplayState

const sessionsDir = () => join(root, 'sessions')
let purged: string[]
let purgeError: Error | undefined
const deps = () => ({
  state,
  purgeChat: (chat: string) => { purged.push(chat); return purgeError === undefined ? Promise.resolve() : Promise.reject(purgeError) },
  sessionsDir,
})
const world = { id: 'blackwater', name: 'The Blackwater Observatory' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'delete-session-'))
  purged = []
  purgeError = undefined
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('deleteSession', () => {
  it('removes the whole session folder, even while the session is open', async () => {
    const session = state.createSession(sessionsDir(), { name: 'Night one', world })
    const { id } = session.metadata.get()
    await deleteSession(deps(), id)
    expect(existsSync(join(sessionsDir(), id))).toBe(false)
    expect(state.listSessions(sessionsDir()).sessions).toEqual([])
  })

  it('leaves other sessions alone', async () => {
    const kept = state.createSession(sessionsDir(), { name: 'Kept', world }).metadata.get().id
    const gone = state.createSession(sessionsDir(), { name: 'Gone', world }).metadata.get().id
    await deleteSession(deps(), gone)
    expect(state.listSessions(sessionsDir()).sessions.map(session => session.id)).toEqual([kept])
  })

  it('removes the chat from DSH\'s store first, with what it started', async () => {
    const { id } = state.createSession(sessionsDir(), { name: 'Night one', world }).metadata.get()
    await deleteSession(deps(), id)
    expect(purged).toEqual([`session-${id}`])
  })

  it('keeps the session when its chat cannot be removed completely, so that deleting can be tried again', async () => {
    const { id } = state.createSession(sessionsDir(), { name: 'Night one', world }).metadata.get()
    purgeError = new Error('chat is busy')
    await expect(deleteSession(deps(), id)).rejects.toThrow('chat is busy')
    expect(existsSync(join(sessionsDir(), id))).toBe(true)
  })

  it('refuses an id that names no session, and ids that are not session ids', async () => {
    await expect(deleteSession(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).rejects.toThrow(SessionNotFoundError)
    await expect(deleteSession(deps(), '../worlds')).rejects.toThrow(SessionNotFoundError)
    await expect(deleteSession(deps(), '')).rejects.toThrow(SessionNotFoundError)
    expect(purged).toEqual([])
  })
})
