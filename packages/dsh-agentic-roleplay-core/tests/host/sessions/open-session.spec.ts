import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { openSession } from '../../../src/host/sessions/open-session.ts'

let root: string
let state: RoleplayState
let ensured: string[]

const deps = () => ({
  agent: { ensure: (id: string) => { ensured.push(id); return Promise.resolve(`session-${id}`) } },
  sessionsDir: () => join(root, 'sessions'),
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-session-'))
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  ensured = []
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('openSession', () => {
  it('makes sure the session has its chat and names it', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    expect(await openSession(deps(), id)).toEqual({ id, chatSessionId: `session-${id}` })
    expect(ensured).toEqual([id])
  })

  it('refuses an id that names no session, without creating a chat', async () => {
    await expect(openSession(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).rejects.toThrow(SessionNotFoundError)
    await expect(openSession(deps(), '../worlds')).rejects.toThrow(SessionNotFoundError)
    expect(ensured).toEqual([])
  })
})
