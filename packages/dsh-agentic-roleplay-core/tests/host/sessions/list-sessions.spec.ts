import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listSessions } from '../../../src/host/sessions/list-sessions.ts'

let root: string
let state: RoleplayState

const deps = () => ({ state, sessionsDir: () => join(root, 'sessions') })
const world = { id: 'blackwater', name: 'The Blackwater Observatory' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'list-sessions-'))
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('listSessions', () => {
  it('is empty before any session exists', () => {
    expect(listSessions(deps())).toEqual({ directory: join(root, 'sessions'), sessions: [], problems: [] })
  })

  it('describes each session for the list', () => {
    const session = state.createSession(join(root, 'sessions'), { name: 'Night one', world })
    session.metadata.recordTurn()
    const [summary] = listSessions(deps()).sessions
    expect(summary).toEqual({
      id: session.metadata.get().id,
      chatSessionId: `session-${session.metadata.get().id}`,
      name: 'Night one',
      worldId: 'blackwater',
      worldName: 'The Blackwater Observatory',
      createdAt: session.metadata.get().createdAt,
      lastPlayedAt: session.metadata.get().lastPlayedAt,
      turns: 1,
    })
  })

  it('leaves out the time of last play for a session that was never played', () => {
    state.createSession(join(root, 'sessions'), { name: 'New', world })
    expect(listSessions(deps()).sessions[0]).not.toHaveProperty('lastPlayedAt')
  })

  it('puts the most recently played first, counting a session never played from its creation', async () => {
    const sessionsDir = join(root, 'sessions')
    const oldest = state.createSession(sessionsDir, { name: 'Oldest', world })
    await new Promise(resolve => setTimeout(resolve, 5))
    const played = state.createSession(sessionsDir, { name: 'Played', world })
    await new Promise(resolve => setTimeout(resolve, 5))
    const newest = state.createSession(sessionsDir, { name: 'Newest', world })
    await new Promise(resolve => setTimeout(resolve, 5))
    oldest.metadata.recordTurn()
    expect(listSessions(deps()).sessions.map(session => session.name)).toEqual(['Oldest', 'Newest', 'Played'])
    played.metadata.recordTurn()
    expect(listSessions(deps()).sessions.map(session => session.name)).toEqual(['Played', 'Oldest', 'Newest'])
    expect(newest.metadata.get().turns).toBe(0)
  })

  it('reports a session it cannot read, with its folder, and lists the rest', async () => {
    const sessionsDir = join(root, 'sessions')
    state.createSession(sessionsDir, { name: 'Fine', world })
    const broken = '9a1c7e2d-5b3f-4c8a-8e1d-6f2b3c4d5e6f'
    await mkdir(join(sessionsDir, broken))
    await writeFile(join(sessionsDir, broken, 'session.sqlite'), 'not a database')
    const { sessions, problems } = listSessions(deps())
    expect(sessions.map(session => session.name)).toEqual(['Fine'])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.path).toBe(join(sessionsDir, broken))
  })
})
