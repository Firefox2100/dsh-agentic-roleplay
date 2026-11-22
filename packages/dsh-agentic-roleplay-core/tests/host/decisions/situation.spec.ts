import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionSite, GateMode, SiteReport } from '../../../src/shared/decisions.ts'
import type { SituationJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

type Task = { prompt: string; persona: string }
let languageModel: (task: Task) => unknown
const asked: Task[] = []

vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: Task) => { asked.push(task); return languageModel(task) },
  childModel: () => ({}),
  childSampling: () => ({}),
  childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string) => `persona of ${id}` }))

const { situationChecks } = await import('../../../src/host/decisions/situation.ts')

let recorded: { site: DecisionSite; report: SiteReport }[]
let states: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[]

const decider = (probability: number): DecisionService => ({
  decide: async (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => {
    states.push({ state, questions })
    return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

beforeEach(() => {
  asked.length = 0
  recorded = []
  states = []
  languageModel = () => ({ reason: 'only what can be seen or heard', fault: false })
})

const job = (mode: GateMode, over: Partial<SituationJob> = {}): SituationJob => ({
  chat: 'c', turn: 4, player: 'Mara', input: 'I think of Odile. "Sure," I say.', situation: 'Mara says "Sure".',
  store: {
    settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, situation: mode } }),
    text: (id: string) => `wording of ${id}`,
    recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
  } as unknown as TurnStore,
  ...over,
})
const gate = (service?: DecisionService, problem?: (message: string) => void) => situationChecks({ agentOf: () => ({}) as never, ...service === undefined ? {} : { decisions: () => service }, ...problem === undefined ? {} : { problem } })
const signal = new AbortController().signal

describe('the check of the situation', () => {
  it('asks nothing while it is off', async () => {
    expect(await gate(decider(0.99)).check(job('off'), signal)).toBeUndefined()
    expect([asked, states, recorded]).toEqual([[], [], []])
  })

  it('gives the decision model the message and the situation, and sends a fault back in words for the game master', async () => {
    const found = await gate(decider(0.95)).check(job('decision'), signal)
    expect(found).toMatch(/could not have perceived/)
    expect(states[0]!.state).toEqual({ player_character: 'Mara', player_message: 'I think of Odile. "Sure," I say.', situation: 'Mara says "Sure".' })
    expect(Object.values(states[0]!.questions)[0]!.instructions).toBe('wording of roleplay/gate-situation')
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.decided])).toEqual([['situation', 'decision', 1]])
    expect(await gate(decider(0.1)).check(job('decision'), signal)).toBeUndefined()
  })

  it('uses its own cut, lower than the other gates\', for a fault a decision model rates low', async () => {
    expect(await gate(decider(0.35)).check(job('decision'), signal)).toMatch(/could not have perceived/)
    expect(await gate(decider(0.2)).check(job('decision'), signal)).toBeUndefined()
  })

  it('has the language model judge in llm mode', async () => {
    languageModel = () => ({ reason: 'it holds a thought', fault: true })
    expect(await gate().check(job('llm'), signal)).toMatch(/could not have perceived/)
    expect(asked[0]!.persona).toContain('persona of roleplay/gate-situation')
    expect(asked[0]!.prompt).toContain('The situation to check:\nMara says "Sure".')
  })

  it('asks nothing in hybrid while no decision model is selected', async () => {
    languageModel = () => { throw new Error('must not be asked') }
    expect(await gate(undefined).check(job('hybrid'), signal)).toBeUndefined()
  })

  it('has nothing to check without a message or a situation, and never stops a turn it cannot check', async () => {
    expect(await gate(decider(0.99)).check(job('decision', { input: ' ' }), signal)).toBeUndefined()
    expect(await gate(decider(0.99)).check(job('decision', { situation: '' }), signal)).toBeUndefined()
    const say = vi.fn()
    languageModel = () => { throw new Error('model down') }
    expect(await gate(undefined, say).check(job('llm'), signal)).toBeUndefined()
    expect(say).toHaveBeenCalledWith(expect.stringContaining('situation check of turn 4 could not be made'))
  })
})
