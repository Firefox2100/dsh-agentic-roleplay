import { describe, expect, it } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { CastMember, TrackJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { errandChecks } from '../../../src/host/decisions/errands.ts'

const member = (id: number, key: string, name: string, control: 'player' | 'agent' = 'agent'): CastMember => ({ key, character: { id, name, aliases: [], control, kind: 'person', tier: 'principal' } } as unknown as CastMember)

function job(world: { errands?: 'on' | 'off'; probability?: number; asleep?: string[]; offDay?: string[] } = {}) {
  const held: number[] = []
  const recorded: string[] = []
  const cast = [member(1, 'me', 'Edda', 'player'), member(2, 'ann', 'Ann'), member(3, 'bob', 'Bob')]
  const store = {
    text: (_id: string, variables: Record<string, string>) => `about ${variables['name']}`,
    settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, errands: world.errands ?? 'on' } }),
    cast: () => cast,
    asleep: (_turn: number, id: number) => (world.asleep?.includes(cast.find(entry => entry.character.id === id)!.key) === true ? { until: 1 } : undefined),
    agenda: (_turn: number, id: number) => (world.offDay?.includes(cast.find(entry => entry.character.id === id)!.key) === true ? { offDay: { until: 1 } } : {}),
    holdForPlayer: (id: number) => { held.push(id) },
    recordDecisions: (site: string) => { recorded.push(site) },
  } as unknown as TurnStore
  const asked: string[] = []
  const service = { decide: async (request: { answers?: unknown; schema?: unknown; questions?: unknown }) => { void request; return { answers: Object.fromEntries(['ann', 'bob'].map(key => [key, { type: 'noul', probability: key === 'ann' ? world.probability ?? 0.9 : 0.1 }])), model: 'decide-1' } } } as unknown as DecisionService
  void asked
  const run = (input: string, deeds: string[], narration: string, without = false) =>
    errandChecks({ decisions: () => (without ? undefined : service) }).keep({ chat: 'c', turn: 3, store, input, deeds, narration } as TrackJob, new AbortController().signal).then(kept => ({ kept, held, recorded }))
  return { run }
}

describe('characters who wait for the player', () => {
  it('keeps the named character the decision model says was told to wait', async () => {
    const { kept, held } = await job().run('I go to the harbour.', ['Ann: "I will wait here."'], 'Ann nods and stays.')
    expect(kept).toBe(1)
    expect(held).toEqual([2])
  })

  it('asks about nobody the turn does not name, the player, a sleeper or one already off its day', async () => {
    expect((await job().run('I look around.', [], 'The street is quiet.')).kept).toBe(0)
    expect((await job({ asleep: ['ann'] }).run('Ann waits.', [], '')).kept).toBe(0)
    expect((await job({ offDay: ['ann'] }).run('Ann waits.', [], '')).kept).toBe(0)
    expect((await job().run('Edda waits.', [], '')).kept).toBe(0)
  })

  it('keeps nobody when the decision model is unsure, when it is off and when it cannot be asked', async () => {
    expect((await job({ probability: 0.3 }).run('Ann waits.', [], '')).kept).toBe(0)
    expect((await job({ errands: 'off' }).run('Ann waits.', [], '')).kept).toBe(0)
    const none = await job().run('Ann waits.', [], '', true)
    expect([none.kept, none.recorded]).toEqual([0, ['errands']])
  })
})
