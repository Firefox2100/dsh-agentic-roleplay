import { describe, expect, it } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS, type ChatSettings } from '../../../src/shared/settings.ts'
import type { CastMember, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { tickAutonomy, writingChance } from '../../../src/host/orchestration/autonomy.ts'
import type { TurnEngine } from '../../../src/host/orchestration/turn-engine.ts'
import type { AutonomyMessage, AutonomyState } from '../../../src/host/sessions/autonomy.ts'
import type { CharacterReport } from '../../../src/host/orchestration/protocol.ts'

const HOUR = 3_600_000
const NOW = Date.parse('2026-03-10T12:00:00Z')

const member = (key: string, extra: { control?: 'player' | 'agent'; kind?: string; tier?: string; place?: number } = {}): CastMember => ({
  key,
  character: { id: key === 'me' ? 1 : key === 'ann' ? 2 : key === 'bob' ? 3 : 4, name: key[0]!.toUpperCase() + key.slice(1), control: extra.control ?? 'agent', kind: extra.kind ?? 'person', tier: extra.tier ?? 'principal' },
  ...extra.place === undefined ? {} : { place: { location: { id: extra.place }, position: '' } },
} as unknown as CastMember)

interface World {
  settings?: Partial<{ [K in keyof ChatSettings['autonomy']]: ChatSettings['autonomy'][K] }> & { clock?: 'real' | 'simulated' }
  cast?: CastMember[]
  asleep?: string[]
  /** The characters whose day just changed. */
  shifted?: string[]
  /** The decision model's chance that the character has a reason to write; `decisions.messages` is on when it is given, and 'fails' means the service errors. */
  reason?: number | 'fails'
  /** Who is asleep by its day. */
  sleeping?: string[]
  related?: Record<string, number>
  state?: Partial<AutonomyState>
  lastPlayed?: number
  playing?: boolean
  report?: Partial<CharacterReport> | null
}

function setup(world: World = {}) {
  const log = { said: [] as AutonomyMessage[], asked: [] as string[], caught: 0, askedAlone: [] as string[] }
  const cast = world.cast ?? [member('me', { control: 'player', place: 1 }), member('ann', { place: 2 }), member('bob', { place: 3 })]
  const autonomy = { ...DEFAULT_SETTINGS.autonomy, enabled: true, ...world.settings }
  const state: AutonomyState = { unanswered: 0, sent: {}, inbox: [], ...world.state }
  const store = {
    text: (id: string) => id,
    recordDecisions: () => undefined,
    settings: () => ({ ...DEFAULT_SETTINGS, autonomy, decisions: { ...DEFAULT_SETTINGS.decisions, messages: world.reason === undefined ? 'off' : 'on' }, clock: { ...DEFAULT_SETTINGS.clock, mode: world.settings?.clock ?? 'real' } }),
    story: { metadata: { get: () => ({ turns: 4 }) }, relationships: { get: (from: number) => { const key = cast.find(entry => entry.character.id === from)?.key ?? ''; const affinity = world.related?.[key]; return affinity === undefined ? undefined : { affinity } } } },
    cast: () => cast,
    agenda: (_turn: number, id: number) => ({ now: world.asleep?.includes(cast.find(entry => entry.character.id === id)?.key ?? '') === true ? { interruptible: false } : undefined }),
    asleep: (_turn: number, id: number) => (world.sleeping?.includes(cast.find(entry => entry.character.id === id)?.key ?? '') === true ? { until: NOW + HOUR } : undefined),
    time: () => ({ now: NOW, zone: 'UTC' }),
    autonomy: {
      catchUp: () => { log.caught += 1; return [{ character: 'ann' }] },
      shifts: () => world.shifted ?? [],
      state: () => state,
      lastPlayerAt: () => world.lastPlayed ?? NOW - 5 * HOUR,
      said: (_turn: number, message: AutonomyMessage) => { log.said.push(message) },
      asked: (character: string) => { log.asked.push(character) },
      inbox: () => [],
    },
  } as unknown as TurnStore
  const engine = {
    playing: () => world.playing === true,
    askAlone: (_owner: unknown, key: string) => { log.askedAlone.push(key); return Promise.resolve(world.report === null ? undefined : { character: key, name: key, intent: 'writes', commitment: 'medium', utterance: 'Thinking of you. Come by when you can.', ...world.report }) },
  } as unknown as TurnEngine
  const service = world.reason === undefined ? undefined : ({ decide: async () => { if (world.reason === 'fails') throw new Error('down'); return { answers: { write: { type: 'noul', probability: world.reason } }, model: 'decide-1' } } }) as unknown as DecisionService
  const deps = { engine, stores: () => store, boundaries: (() => ({})) as never, agentOf: () => ({}) as never, wall: () => NOW, problem: () => undefined, draw: () => 0, decisions: () => service }
  return { log, deps, store }
}

const tick = async (world?: World, draw?: (key: string) => number) => {
  const { log, deps } = setup(world)
  const run = await tickAutonomy(draw === undefined ? deps : { ...deps, draw }, 'session-1', new AbortController().signal)
  return { run, log }
}

describe('a story that goes on while the player is away', () => {
  it('does nothing unless it was switched on and runs on the real clock, and never while a turn is played', async () => {
    expect((await tick({ settings: { enabled: false } })).run).toEqual({ outcome: 'off', moved: 0 })
    expect((await tick({ settings: { clock: 'simulated' } })).run).toEqual({ outcome: 'off', moved: 0 })
    const busy = await tick({ playing: true })
    expect(busy.run).toEqual({ outcome: 'busy', moved: 0 })
    expect(busy.log.caught).toBe(0)
  })

  it('takes the days of the characters up to the time, without a request, even when nobody writes', async () => {
    const quiet = await tick({ settings: { messages: false } })
    expect(quiet.run).toEqual({ outcome: 'quiet', moved: 1 })
    expect(quiet.log.askedAlone).toEqual([])
  })

  it('waits until the player has been away long enough, and stops after the limit with no reply', async () => {
    expect((await tick({ lastPlayed: NOW - 10 * 60_000 })).run.outcome).toBe('recent')
    const limit = await tick({ state: { unanswered: 3 } })
    expect(limit.run.outcome).toBe('limit')
    expect(limit.log.askedAlone).toEqual([])
  })

  it('lets a character who knows the player write once, and records the message', async () => {
    const { run, log } = await tick({ related: { ann: 0.8, bob: 0.1 } })
    expect(run).toMatchObject({ outcome: 'wrote', message: 'Thinking of you. Come by when you can.' })
    expect(log.askedAlone).toEqual(['ann'])
    expect(log.said).toEqual([{ at: NOW, character: 'ann', name: 'Ann', text: 'Thinking of you. Come by when you can.' }])
  })

  it('notes a character that would not write so that it is not asked again before the gap, and writes nothing for an empty, low or wrong-language answer', async () => {
    for (const report of [{ commitment: 'low' as const }, { utterance: '' }, { utterance: '这是一条很长的中文消息，但是这个故事是用英文写的，所以不应该被接受。' }, null]) {
      const { run, log } = await tick({ related: { ann: 0.8 }, report })
      expect(run.outcome, JSON.stringify(report)).toBe('quiet')
      expect(log.said).toEqual([])
      expect(log.asked).toEqual(['ann'])
    }
    expect((await tick({ related: { ann: 0.8 }, state: { sent: { ann: NOW - HOUR } } })).run.outcome).toBe('nobody')
  })

  it('leaves it to chance: a draw above the chance of the look, no message', async () => {
    expect((await tick({ related: { ann: 0.8 } }, () => 0.99)).run.outcome).toBe('idle')
  })

  it('writes less and less often for each message sent with no reply', async () => {
    const draw = () => 0.03
    expect((await tick({ related: { ann: 0.8 } }, draw)).run.outcome).toBe('wrote')
    expect((await tick({ related: { ann: 0.8 }, state: { unanswered: 1 } }, draw)).run.outcome).toBe('idle')
    expect((await tick({ related: { ann: 0.8 }, state: { unanswered: 1 }, settings: { decay: 1 } }, draw)).run.outcome).toBe('wrote')
    expect((await tick({ related: { ann: 0.8 }, settings: { decay: 0 }, state: { unanswered: 0 } }, draw)).run.outcome).toBe('wrote')
    expect((await tick({ related: { ann: 0.8 }, settings: { decay: 0, maxUnanswered: 5 }, state: { unanswered: 1 } }, draw)).run.outcome).toBe('idle')
  })

  it('does not write to a player who has been away longer than the gate', async () => {
    const gone = await tick({ related: { ann: 0.8 }, lastPlayed: NOW - 13 * HOUR })
    expect(gone.run.outcome).toBe('away')
    expect(gone.log.askedAlone).toEqual([])
  })

  it('lets a character whose day just changed write at that look, even when chance would not have', async () => {
    const draw = (key: string) => (key.includes(':shift:') ? 0 : 0.99)
    const changed = await tick({ related: { ann: 0.8, bob: 0.8 }, shifted: ['bob'] }, draw)
    expect(changed.run.outcome).toBe('wrote')
    expect(changed.log.askedAlone).toEqual(['bob'])
    expect((await tick({ related: { ann: 0.8, bob: 0.8 } }, draw)).run.outcome).toBe('idle')
    expect((await tick({ related: { ann: 0.8, bob: 0.8 }, shifted: ['bob'], settings: { transitionChance: 0 } }, draw)).run.outcome).toBe('idle')
  })

  it('asks the decision model whether the picked character has a reason, and stays quiet when it has none', async () => {
    const no = await tick({ related: { ann: 0.8 }, reason: 0.1 })
    expect(no.run.outcome).toBe('declined')
    expect(no.log.askedAlone).toEqual([])
    expect((await tick({ related: { ann: 0.8 }, reason: 0.9 })).run.outcome).toBe('wrote')
  })

  it('lets chance alone decide when the decision model cannot be used', async () => {
    expect((await tick({ related: { ann: 0.8 }, reason: 'fails' })).run.outcome).toBe('wrote')
  })
})

describe('who could write', () => {
  const player = member('me', { control: 'player', place: 1 })
  const store = (world: World): TurnStore => setup(world).store
  const chance = (world: World, who: CastMember, idle = 5 * HOUR) => writingChance(store(world), who, player, 4, idle)

  it('is a person who knows the player, is awake and is not with them', () => {
    expect(chance({ related: { ann: 0.5 } }, member('ann', { place: 2 }))).toBeGreaterThan(0.15)
    expect(chance({ related: {} }, member('ann', { place: 2 }))).toBeUndefined()
    expect(chance({ related: { ann: 0.5 }, asleep: ['ann'] }, member('ann', { place: 2 }))).toBeUndefined()
    expect(chance({ related: { ann: 0.5 }, sleeping: ['ann'] }, member('ann', { place: 2 }))).toBeUndefined()
    expect(chance({ related: { ann: 0.5 } }, member('ann', { place: 1 }))).toBeUndefined()
    expect(chance({ related: { ann: 0.5 } }, member('ann', { kind: 'group', place: 2 }))).toBeUndefined()
    expect(chance({ related: { ann: 0.5 } }, member('ann', { tier: 'background', place: 2 }))).toBeUndefined()
  })

  it('is likelier for a closer character and for a longer time away, and never above 0.9', () => {
    const close = chance({ related: { ann: 1 } }, member('ann', { place: 2 }), 48 * HOUR)!
    const distant = chance({ related: { ann: 0 } }, member('ann', { place: 2 }), HOUR)!
    expect(close).toBeGreaterThan(distant)
    expect(close).toBeLessThanOrEqual(0.9)
  })
})
