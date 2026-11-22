import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { RoleplayState, sessionFolder } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { matchPulledSession } from '../../../src/host/sessions/pulled-session.ts'
import { writeStatus } from '../../../src/host/sessions/status.ts'
import { removeTemp } from '../../support/temp.ts'

let root: string
let state: RoleplayState
let calls: string[]
const sessionsDir = () => join(root, 'sessions')
const deps = () => ({
  agent: {
    archive: (id: string) => { calls.push(`archive ${id}`); return Promise.resolve() },
    restore: (id: string) => { calls.push(`restore ${id}`); return Promise.resolve() },
  },
  sessionsDir,
  rebuild: (id: string) => { calls.push(`rebuild ${id}`); return Promise.resolve() },
})
const make = (): string => state.createSession(sessionsDir(), { name: 'Night one', world: { id: 'blackwater', name: 'The Blackwater Observatory' } }).metadata.get().id

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulled-session-'))
  calls = []
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
})
afterEach(async () => { await removeTemp(root, state) })

describe('a session pulled from another device', () => {
  it('is put away here when it was put away there, and no chat is made', async () => {
    const id = make()
    writeStatus(sessionFolder(sessionsDir(), id), { archivedAt: '2026-11-20T10:00:00.000Z' })
    expect(await matchPulledSession(deps(), id)).toBe('archived')
    expect(calls).toEqual([`archive ${id}`])
  })

  it('is shown again and its chat made from the files when it is in use there', async () => {
    const id = make()
    expect(await matchPulledSession(deps(), id)).toBe('active')
    expect(calls).toEqual([`restore ${id}`, `rebuild ${id}`])
  })
})
