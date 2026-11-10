import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionSite, RepeatMode, SiteReport } from '../../../src/shared/decisions.ts'
import type { GateJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

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

const { repeatedSentences } = await import('../../../src/host/decisions/repeats.ts')
const { outputGates } = await import('../../../src/host/decisions/gates.ts')

let recorded: { site: DecisionSite; report: SiteReport }[]
let questions: Record<string, { instructions: string }>[]

const decider = (probability: (key: string) => number): DecisionService => ({
  decide: async (_state: Record<string, unknown>, asks: Record<string, { instructions: string }>) => {
    questions.push(asks)
    return { answers: Object.fromEntries(Object.keys(asks).map(key => [key, { type: 'noul', probability: probability(key) }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

beforeEach(() => {
  asked.length = 0
  recorded = []
  questions = []
  languageModel = () => ({ reason: 'filler', stale: [1] })
})

const RAIN = 'The rain outside shows no sign of stopping.'
const job = (mode: RepeatMode, narration = `${RAIN} Mira looks up from her cup.`): GateJob => ({
  chat: 'c', turn: 5, input: 'I wait.', player: 'Arthur', narration, passage: narration, secrets: [],
  store: {
    settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, repeats: mode } }),
    text: (id: string, variables?: Record<string, string>) => `wording of ${id} for ${variables?.sentence ?? ''}`,
    recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
  } as unknown as TurnStore,
})
const gates = (service: DecisionService | undefined, earlier: string[]) => outputGates({ agentOf: () => ({}) as never, ...service === undefined ? {} : { decisions: () => service }, earlier: () => earlier })
const signal = new AbortController().signal

describe('repeatedSentences', () => {
  it('finds the sentences an earlier turn told in the same words, ignoring case and spacing, and once each', () => {
    expect(repeatedSentences(`${RAIN} Mira nods. the rain outside  shows no sign of stopping.`, [`She waited. ${RAIN}`], 12)).toEqual([RAIN])
  })

  it('lets short sentences come back and finds a sentence repeated inside one narration', () => {
    expect(repeatedSentences('Yes. Yes.', ['Yes.'], 12)).toEqual([])
    expect(repeatedSentences('The lamp flickers twice. The lamp flickers twice.', [], 12)).toEqual(['The lamp flickers twice.'])
  })

  it('splits Chinese sentences at their own marks', () => {
    expect(repeatedSentences('外头的雨没停的意思。她抬起头。', ['外头的雨没停的意思。窗边很安静。'], 6)).toEqual(['外头的雨没停的意思。'])
  })
})

describe('the repeats check', () => {
  it('does nothing while it is off, and when nothing was told before', async () => {
    expect(await gates(decider(() => 0.99), [RAIN]).check(job('off'), signal)).toEqual([])
    expect(await gates(decider(() => 0.99), ['Something else entirely.']).check(job('decision'), signal)).toEqual([])
    expect([asked, questions, recorded]).toEqual([[], [], []])
  })

  it('sends back every repeat with no model at all in strict mode', async () => {
    const found = await gates(undefined, [RAIN]).check(job('strict'), signal)
    expect(found).toEqual([{ gate: 'repeats', message: expect.stringContaining(`"${RAIN}"`) }])
    expect([asked, questions, recorded]).toEqual([[], [], []])
  })

  it('asks the decision model about the repeated sentence only, and sends back what it calls stale', async () => {
    const found = await gates(decider(() => 0.9), [RAIN]).check(job('decision'), signal)
    expect(found).toHaveLength(1)
    expect(questions).toHaveLength(1)
    expect(Object.values(questions[0]!)[0]!.instructions).toBe(`wording of roleplay/gate-repeat for ${RAIN}`)
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.items])).toEqual([['repeats', 'decision', 1]])
  })

  it('lets a repeat that is meant pass', async () => {
    expect(await gates(decider(() => 0.05), [RAIN]).check(job('decision'), signal)).toEqual([])
  })

  it('has the language model number the stale ones in llm mode', async () => {
    const found = await gates(undefined, [RAIN]).check(job('llm'), signal)
    expect(found).toHaveLength(1)
    expect(asked[0]!.prompt).toContain(`1. ${RAIN}`)
    languageModel = () => ({ reason: 'a refrain', stale: [] })
    expect(await gates(undefined, [RAIN]).check(job('llm'), signal)).toEqual([])
  })

  it('goes on without a finding when a model cannot judge', async () => {
    const say = vi.fn()
    languageModel = () => { throw new Error('model down') }
    const found = await outputGates({ agentOf: () => ({}) as never, earlier: () => [RAIN], problem: say }).check(job('llm'), signal)
    expect(found).toEqual([])
    expect(say).toHaveBeenCalledWith(expect.stringContaining('repeats check'))
  })
})
