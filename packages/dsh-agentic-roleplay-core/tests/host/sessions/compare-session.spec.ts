import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareSession, UnknownStateError } from '../../../src/host/sessions/compare-session.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'

let base: string
let ctx: Context
let fiber: { dispose(): void }
const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
const sessionsDir = () => join(base, 'sessions')
const deps = () => ({ state: state(), sessionsDir })

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'compare-'))
  ctx = new Context()
  fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
  await new Promise(resolve => setTimeout(resolve, 20))
})
afterEach(async () => {
  fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 20))
  await rm(base, { recursive: true, force: true })
})

function story() {
  const store = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W', source: 'worlds/w' } })
  const id = store.metadata.get().id
  store.characters.add({ aliases: [], kind: 'person', tier: 'principal', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'ana', name: 'Ana', role: 'npc', control: 'agent' })
  state().snapshot(sessionsDir(), id, 'after-n1')
  store.metadata.recordTurn()
  state().snapshot(sessionsDir(), id, 'after-n2')
  writeFileSync(join(statePlugin.sessionFolder(sessionsDir(), id), 'timeline.json'), JSON.stringify({
    version: 1, head: 'n2', next: 3, nodes: [
      { id: 'n1', parent: null, turn: 1, userSeq: 0, player: 'a', createdAt: 'x', label: 'Before the storm' },
      { id: 'n2', parent: 'n1', turn: 2, userSeq: 1, player: 'b', createdAt: 'x' },
    ],
  }))
  mkdirSync(join(statePlugin.sessionFolder(sessionsDir(), id), 'snapshots'), { recursive: true })
  return id
}

describe('comparing two states of a session', () => {
  it('reads the kept state of a turn and the story as it is, and names them', () => {
    const id = story()
    const result = compareSession(deps(), id, 'n1', 'head')
    expect(result.a).toBe('“Before the storm” (turn 1)')
    expect(result.b).toBe('now')
    expect(result.changes).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'turns' })]))
    expect(compareSession(deps(), id, 'n1', 'n2').b).toBe('turn 2')
  })

  it('says when a turn is unknown or its state is not kept, and when the session is', () => {
    const id = story()
    expect(() => compareSession(deps(), id, 'n9', 'head')).toThrow(UnknownStateError)
    state().removeSnapshot(sessionsDir(), id, 'after-n1')
    expect(() => compareSession(deps(), id, 'n1', 'head')).toThrow(/not kept/)
    expect(() => compareSession(deps(), '11111111-1111-4111-8111-111111111111', 'head', 'head')).toThrow(SessionNotFoundError)
  })
})
