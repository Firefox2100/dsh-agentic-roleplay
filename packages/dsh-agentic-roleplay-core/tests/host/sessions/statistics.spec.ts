import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { branchesOf, lengthOf, speakingOf, statisticsOfSession } from '../../../src/host/sessions/statistics.ts'
import type { Timeline } from '../../../src/shared/timeline.ts'

const node = (id: string, parent: string | null, turn: number, segments: unknown[] = []) => ({ id, parent, turn, userSeq: turn, player: `p${turn}`, createdAt: 'x', output: { segments, repaired: false } })
const timeline = (head: string): Timeline => ({
  version: 1, head, next: 5, nodes: [
    node('n1', null, 1, [{ type: 'narration', text: 'The fog rolls in over the quay.' }, { type: 'utterance', character: 'clara', name: 'Clara', text: 'Mind the step.' }]),
    node('n2', 'n1', 2, [{ type: 'utterance', character: 'clara', name: 'Clara', text: 'Another round?' }, { type: 'utterance', character: 'tomas', name: 'Tomas', text: 'No.' }]),
    node('n3', 'n1', 2, [{ type: 'narration', text: 'Set aside.' }]),
  ],
}) as never

describe('counting a story', () => {
  it('measures words, and each character of a script written without spaces', () => {
    expect(lengthOf('Mind the step.')).toBe(3)
    expect(lengthOf('小心台阶，朋友。')).toBe(7)
    expect(lengthOf('')).toBe(0)
  })

  it('counts who spoke how much on the way the story went, and leaves out the turn that was set aside', () => {
    const { speaking, narration } = speakingOf(timeline('n2'))
    expect(speaking).toEqual([{ name: 'Clara', lines: 2, length: 5 }, { name: 'Tomas', lines: 1, length: 1 }])
    expect(narration).toEqual({ passages: 1, length: 7 })
  })

  it('counts the turns played again from one state, and those that are off the way the story went', () => {
    expect(branchesOf(timeline('n2'))).toEqual({ branchPoints: 1, setAside: 1 })
    expect(branchesOf(timeline('n3'))).toEqual({ branchPoints: 1, setAside: 1 })
  })
})

describe('the statistics of a session', () => {
  let base: string
  let ctx: Context
  let fiber: { dispose(): void }
  const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
  const sessionsDir = () => join(base, 'sessions')
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'stats-'))
    ctx = new Context()
    fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  afterEach(async () => {
    fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    await rm(base, { recursive: true, force: true })
  })

  it('gathers the shape of the story from its files and records', () => {
    const story = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W', source: 'worlds/w' } })
    const id = story.metadata.get().id
    mkdirSync(statePlugin.sessionFolder(sessionsDir(), id), { recursive: true })
    writeFileSync(join(statePlugin.sessionFolder(sessionsDir(), id), 'timeline.json'), JSON.stringify(timeline('n2')))
    story.threads.open('Find the ledger', 1)
    story.threads.open('Reach the tower', 2)
    story.clock.start('simulated', Date.UTC(2030, 0, 1))
    story.clock.advance({ to: Date.UTC(2030, 0, 1, 2), turn: 1, round: 1, kind: 'elapsed' })
    const result = statisticsOfSession({ state: state(), sessionsDir }, id)
    expect(result).toMatchObject({
      turns: 2, scenes: 0, threads: { open: 2, resolved: 0 }, relationships: { total: 0, changed: 0 }, branches: { branchPoints: 1, setAside: 1 },
      storyTime: { start: '2030-01-01T00:00:00.000Z', now: '2030-01-01T02:00:00.000Z', elapsedSeconds: 7200 }, usage: { runs: 0, masterTokens: 0, helperTokens: 0 },
    })
    expect(result.speaking[0]).toEqual({ name: 'Clara', lines: 2, length: 5 })
  })

  it('refuses an id that names no session', () => {
    expect(() => statisticsOfSession({ state: state(), sessionsDir }, '11111111-1111-4111-8111-111111111111')).toThrow(SessionNotFoundError)
  })
})
