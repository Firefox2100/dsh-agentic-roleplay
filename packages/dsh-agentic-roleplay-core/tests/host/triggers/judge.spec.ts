import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionMode, DecisionSite, SiteReport } from '../../../src/shared/decisions.ts'
import type { JudgeJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

type Task = { prompt: string; beforeSubmit?: (value: unknown) => string | undefined }
let languageModel: (task: Task) => unknown
const asked: Task[] = []
const estimates: number[] = []

vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: Task) => {
    asked.push(task)
    const value = languageModel(task)
    const refusal = task.beforeSubmit?.(value)
    if (refusal !== undefined) throw new Error(refusal)
    return value
  },
  childModel: () => ({}),
  childSampling: (_settings: unknown, _kind: string, estimate: number) => { estimates.push(estimate); return {} },
  childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: () => 'persona' }))

const { triggerJudge } = await import('../../../src/host/triggers/judge.ts')

const FIRST = 'Alice no longer trusts Bob.'
const SECOND = 'The vault stands open.'

let session: SessionStore
let recorded: { site: DecisionSite; report: SiteReport }[]
let questions: Record<string, { instructions: string }>[]
let states: unknown[]

/** A decision service that answers each statement with the probability the test gives for its text. */
const decisions = (table: Record<string, number>): DecisionService => ({
  decide: async (state: unknown, asked: Record<string, { instructions: string }>) => {
    states.push(state)
    questions.push(asked)
    return { answers: Object.fromEntries(Object.entries(asked).map(([key, question]) => [key, { type: 'noul', probability: Object.entries(table).find(([statement]) => question.instructions.includes(statement))![1] }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

beforeEach(() => {
  asked.length = 0
  estimates.length = 0
  recorded = []
  questions = []
  states = []
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, tier: 'principal' as const, role: 'npc' as const, control: 'agent' as const }
  const { id } = session.characters.add({ ...base, sourceId: 'alice', name: 'Alice' })
  session.characterStates.create(id, { publicState: 'tense', innerState: '', activity: 'watching' })
  session.triggers.add({ key: 'trust', name: 'Trust broken', condition: { type: 'judged', text: FIRST }, effects: [{ type: 'beat', text: 'Alice keeps her distance.' }], repeat: false, priority: 0 }, 'world', 0)
  session.triggers.add({ key: 'vault', name: 'Vault open', condition: { type: 'judged', text: SECOND }, effects: [{ type: 'beat', text: 'The vault is found open.' }], repeat: false, priority: 0 }, 'world', 0)
  session.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'Bob lied to Alice about the key.', importance: 3, tags: [], involves: [], perceivedBy: [] }] }, { seal: true })
  languageModel = () => ({ verdicts: [{ number: 1, holds: true, reason: 'shown' }, { number: 2, holds: false, reason: 'not shown' }] })
})
afterEach(() => { session.close() })

const run = async (mode: DecisionMode, service: DecisionService | undefined, options: { confidence?: number; judgedPerTurn?: number; judge?: ReturnType<typeof triggerJudge>; problem?: (message: string) => void } = {}) => {
  const store = {
    story: session, settings: () => ({ ...DEFAULT_SETTINGS, triggers: { ...DEFAULT_SETTINGS.triggers, judgedPerTurn: options.judgedPerTurn ?? 2 }, decisions: { ...DEFAULT_SETTINGS.decisions, triggers: mode, confidence: options.confidence ?? 0.7 } }),
    cast: () => [{ character: { name: 'Alice' }, state: { publicState: 'tense', activity: 'watching' } }], text: (id: string, variables?: Record<string, string>) => `${id}: ${variables?.['statement'] ?? ''}`,
    recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
  } as unknown as TurnStore
  const judge = options.judge ?? triggerJudge({ agentOf: () => ({}) as never, ...service === undefined ? {} : { decisions: () => service }, ...options.problem === undefined ? {} : { problem: options.problem } })
  const result = await judge.judge({ chat: 'c', turn: 3, store } as JudgeJob, new AbortController().signal)
  return { result, verdicts: session.metadata.getValue('triggers.judged') as Record<string, { holds: boolean; turn: number }> }
}

describe('judging the statements triggers wait on', () => {
  it('has the language model judge them in one request, as before, and never asks the decision model', async () => {
    const service = decisions({ [FIRST]: 0.99, [SECOND]: 0.99 })
    const { result, verdicts } = await run('llm', service)
    expect(result.judged).toBe(2)
    expect(asked).toHaveLength(1)
    expect(asked[0]!.prompt).toContain(`1. ${FIRST}`)
    expect(verdicts).toEqual({ [FIRST]: { holds: true, turn: 3 }, [SECOND]: { holds: false, turn: 3 } })
    expect(questions).toEqual([])
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.items, entry.report.decided])).toEqual([['triggers', 'llm', 2, 0]])
  })

  it('gives the language model room for the reason of each verdict, not only for the shape of the answer', async () => {
    await run('llm', undefined)
    expect(estimates).toHaveLength(1)
    // two statements, each a number, a yes or no and a reason of up to 600 characters (200 tokens in English)
    expect(estimates[0]).toBeGreaterThanOrEqual(2 * (200 + 3 * 8))
  })

  it('has the decision model answer a yes-or-no question for each statement in one request, with the shown story, and asks the language model nothing', async () => {
    const { result, verdicts } = await run('decision', decisions({ [FIRST]: 0.97, [SECOND]: 0.5 }))
    expect(result.judged).toBe(2)
    expect(asked).toEqual([])
    expect(questions).toHaveLength(1)
    expect(Object.values(questions[0]!).map(question => question.instructions)).toEqual([`roleplay/decide-trigger: ${FIRST}`, `roleplay/decide-trigger: ${SECOND}`])
    expect(states[0]).toEqual({ recorded_events: ['Bob lied to Alice about the key.'], where_everyone_is: ['Alice: tense; watching'] })
    expect(verdicts).toEqual({ [FIRST]: { holds: true, turn: 3 }, [SECOND]: { holds: false, turn: 3 } })
    expect(recorded[0]!.report).toMatchObject({ mode: 'decision', items: 2, decided: 2, escalated: 0 })
  })

  it('asks the language model only about the statement the decision model is unsure of, in hybrid mode', async () => {
    const { verdicts } = await run('hybrid', decisions({ [FIRST]: 0.99, [SECOND]: 0.55 }))
    expect(asked).toHaveLength(1)
    expect(asked[0]!.prompt).toContain(`1. ${SECOND}`)
    expect(asked[0]!.prompt).not.toContain(FIRST)
    expect(verdicts).toEqual({ [FIRST]: { holds: true, turn: 3 }, [SECOND]: { holds: true, turn: 3 } })
    expect(recorded[0]!.report).toMatchObject({ decided: 1, escalated: 1 })
  })

  it('uses the language model\'s verdicts and records whether the decision model agreed, in shadow mode', async () => {
    const { verdicts } = await run('shadow', decisions({ [FIRST]: 0.99, [SECOND]: 0.95 }))
    expect(verdicts).toEqual({ [FIRST]: { holds: true, turn: 3 }, [SECOND]: { holds: false, turn: 3 } })
    expect(recorded[0]!.report).toMatchObject({ mode: 'shadow', agreed: 1, disagreed: 1 })
    expect(recorded[0]!.report.samples).toEqual([{ turn: 3, what: SECOND, probability: 0.95, decision: true, llm: false }])
  })

  it('goes on with the language model when there is no decision service, and says so once', async () => {
    const say = vi.fn()
    const judge = triggerJudge({ agentOf: () => ({}) as never, problem: say })
    const { verdicts } = await run('decision', undefined, { judge })
    await run('decision', undefined, { judge })
    expect(asked).toHaveLength(2)
    expect(verdicts[FIRST]).toEqual({ holds: true, turn: 3 })
    expect(recorded[0]!.report).toMatchObject({ fallbacks: 2, decided: 0, problem: expect.stringContaining('no decision service') })
    expect(say).toHaveBeenCalledOnce()
  })

  it('judges nothing, and asks nobody, when judging is off', async () => {
    expect((await run('decision', decisions({}), { judgedPerTurn: 0 })).result.judged).toBe(0)
    expect(recorded).toEqual([])
    expect(questions).toEqual([])
  })
})
