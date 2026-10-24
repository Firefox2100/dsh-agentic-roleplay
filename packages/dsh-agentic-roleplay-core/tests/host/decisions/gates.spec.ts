import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionSite, GateMode, SiteReport } from '../../../src/shared/decisions.ts'
import type { GateJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

type Task = { prompt: string; persona: string }
let languageModel: (task: Task) => unknown
const asked: Task[] = []
const estimates: number[] = []

vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: Task) => { asked.push(task); return languageModel(task) },
  childModel: () => ({}),
  childSampling: (_settings: unknown, _kind: string, estimate: number) => { estimates.push(estimate); return {} },
  childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string) => `persona of ${id}` }))

const { outputGates } = await import('../../../src/host/decisions/gates.ts')

let recorded: { site: DecisionSite; report: SiteReport }[]
let states: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[]

/** A decision service that answers every question with the probability the test gives for the state it is asked about. */
const decider = (probability: (state: Record<string, unknown>) => number): DecisionService => ({
  decide: async (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => {
    states.push({ state, questions })
    return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability: probability(state) }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

beforeEach(() => {
  asked.length = 0
  estimates.length = 0
  recorded = []
  states = []
  languageModel = () => ({ reason: 'it stays inside the story', fault: false })
})

const job = (modes: { agency?: GateMode; refusal?: GateMode; gateThreshold?: number }, over: Partial<GateJob> = {}): GateJob => ({
  chat: 'c', turn: 5, input: 'I open the vault door.', player: 'Arthur',
  narration: 'The door groans. Arthur says he is afraid and steps inside.', passage: 'The door groans. Arthur says he is afraid and steps inside.\nClara: "Careful."', secrets: [],
  store: {
    settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, agency: modes.agency ?? 'off', refusal: modes.refusal ?? 'off', gateThreshold: modes.gateThreshold ?? 0.5 } }),
    text: (id: string) => `wording of ${id}`,
    recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
  } as unknown as TurnStore,
  ...over,
})

const gates = (service?: DecisionService, problem?: (message: string) => void) => outputGates({ agentOf: () => ({}) as never, ...service === undefined ? {} : { decisions: () => service }, ...problem === undefined ? {} : { problem } })
const signal = new AbortController().signal

describe('the checks of the output', () => {
  it('check nothing, ask nobody and record nothing while every gate is off', async () => {
    const service = decider(() => 0.99)
    expect(await gates(service).check(job({}), signal)).toEqual([])
    expect([asked, states, recorded]).toEqual([[], [], []])
  })

  it('have the decision model say whether the narration speaks for the player, with the player\'s message and the narration as its state, in decision mode', async () => {
    const found = await gates(decider(() => 0.97)).check(job({ agency: 'decision' }), signal)
    expect(found).toEqual([{ gate: 'agency', message: expect.stringContaining('speaks, acts or thinks for Arthur') }])
    expect(asked).toEqual([])
    expect(states).toHaveLength(1)
    expect(states[0]!.state).toEqual({ player_character: 'Arthur', player_message: 'I open the vault door.', narration: 'The door groans. Arthur says he is afraid and steps inside.' })
    expect(Object.values(states[0]!.questions)[0]!.instructions).toBe('wording of roleplay/gate-agency')
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.decided])).toEqual([['agency', 'decision', 1]])
  })

  it('count a probability as a fault from the gate\'s own threshold, and find none in what is a little below it, in decision mode', async () => {
    expect(await gates(decider(() => 0.55)).check(job({ agency: 'decision' }), signal)).toHaveLength(1)
    expect(await gates(decider(() => 0.4)).check(job({ agency: 'decision' }), signal)).toEqual([])
    expect(await gates(decider(() => 0.55)).check(job({ agency: 'decision', gateThreshold: 0.7 }), signal)).toEqual([])
  })

  it('have the language model judge it, with its reason first, in llm mode, and never ask the decision model', async () => {
    languageModel = () => ({ reason: 'Arthur is given words the player did not write', fault: true })
    const service = decider(() => 0.01)
    const found = await gates(service).check(job({ agency: 'llm' }), signal)
    expect(found.map(finding => finding.gate)).toEqual(['agency'])
    expect(states).toEqual([])
    expect(asked).toHaveLength(1)
    expect(asked[0]!.persona).toContain('persona of roleplay/gate-agency')
    expect(asked[0]!.prompt).toContain("The player's message:\nI open the vault door.")
    expect(asked[0]!.prompt).toContain('The narration to check:\nThe door groans.')
    expect(estimates[0]).toBeGreaterThanOrEqual(400 / 3)
  })

  it('check the whole passage for stepping out of the story, narration and spoken lines together', async () => {
    const found = await gates(decider(() => 0.99)).check(job({ refusal: 'decision' }), signal)
    expect(found).toEqual([{ gate: 'refusal', message: expect.stringContaining('steps out of the story') }])
    expect(states[0]!.state).toEqual({ passage: 'The door groans. Arthur says he is afraid and steps inside.\nClara: "Careful."' })
    expect(Object.values(states[0]!.questions)[0]!.instructions).toBe('wording of roleplay/gate-refusal')
  })

  it('hand only the unsure to the language model in hybrid mode, and use the language model\'s answer when both are asked in shadow mode', async () => {
    languageModel = () => ({ reason: 'fine', fault: false })
    expect(await gates(decider(() => 0.4)).check(job({ agency: 'hybrid' }), signal)).toEqual([])
    expect(asked).toHaveLength(1)
    asked.length = 0
    expect(await gates(decider(() => 0.2)).check(job({ agency: 'hybrid' }), signal)).toEqual([])
    expect(asked).toEqual([])
    asked.length = 0
    expect(await gates(decider(() => 0.99)).check(job({ agency: 'hybrid' }), signal)).toHaveLength(1)
    expect(asked).toEqual([])
    expect(await gates(decider(() => 0.99)).check(job({ refusal: 'shadow' }), signal)).toEqual([])
    expect(recorded.at(-1)!.report).toMatchObject({ mode: 'shadow', disagreed: 1 })
  })

  it('run both gates side by side and report what each found', async () => {
    const found = await gates(decider(() => 0.99)).check(job({ agency: 'decision', refusal: 'decision' }), signal)
    expect(found.map(finding => finding.gate).sort()).toEqual(['agency', 'refusal'])
    expect(recorded.map(entry => entry.site).sort()).toEqual(['agency', 'refusal'])
  })

  it('have nothing to check when the player wrote nothing or the narration is empty, for the check that needs them', async () => {
    const service = decider(() => 0.99)
    expect(await gates(service).check(job({ agency: 'decision' }, { input: '  ' }), signal)).toEqual([])
    expect(await gates(service).check(job({ agency: 'decision' }, { narration: '' }), signal)).toEqual([])
    expect(states).toEqual([])
  })

  it('never stop the turn: a check that cannot be made is reported once and finds nothing, and a missing decision model falls back to the language model', async () => {
    const say = vi.fn()
    languageModel = () => { throw new Error('the model did not answer') }
    const gate = gates(undefined, say)
    expect(await gate.check(job({ agency: 'llm' }), signal)).toEqual([])
    expect(say).toHaveBeenCalledWith(expect.stringContaining('agency check of turn 5 could not be made'))
    languageModel = () => ({ reason: 'it speaks for him', fault: true })
    const fallen = await gates(undefined, say).check(job({ refusal: 'decision' }), signal)
    expect(fallen.map(finding => finding.gate)).toEqual(['refusal'])
    expect(recorded.at(-1)!.report).toMatchObject({ fallbacks: 1, problem: expect.stringContaining('no decision service') })
  })

  it('let a cancelled turn through as a cancellation, not as a finding', async () => {
    const controller = new AbortController()
    controller.abort()
    const service = { decide: async () => { throw new Error('cancelled') } } as unknown as DecisionService
    await expect(gates(service).check(job({ agency: 'decision' }), controller.signal)).rejects.toThrow('cancelled')
  })
})
