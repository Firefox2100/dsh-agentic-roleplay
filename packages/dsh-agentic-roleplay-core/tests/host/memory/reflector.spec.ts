import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionService } from '@dsh-ai-providers/core'
import type { DecisionMode, DecisionSite, SiteReport } from '../../../src/shared/decisions.ts'
import type { ReflectionJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

type Task = { prompt: string; result: unknown; beforeSubmit?: (value: unknown) => string | undefined }
let answer: (task: Task) => unknown

vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: Task) => {
    const value = answer(task)
    const refusal = task.beforeSubmit?.(value)
    if (refusal !== undefined) throw new Error(refusal)
    return value
  },
  childModel: () => ({}),
  childSampling: () => ({}),
  childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: () => 'persona' }))

const { memoryReflector } = await import('../../../src/host/memory/reflection.ts')

let session: SessionStore
beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, tier: 'principal' as const, role: 'npc' as const, control: 'agent' as const }
  for (const [sourceId, name] of [['clara', 'Clara'], ['eleanor', 'Eleanor']] as const) {
    const { id } = session.characters.add({ ...base, sourceId, name })
    session.characterStates.create(id, { publicState: '', innerState: '', activity: 'idle' })
  }
  const happen = (turn: number, text: string, who: string): void => {
    session.edit({ turn, events: [{ turn, round: 1, text, importance: 2, tags: [], involves: [], perceivedBy: [{ character: who, mode: 'witnessed' as const, content: text, gist: text }] }] }, { seal: true })
  }
  happen(1, 'The ridge path is washed out', 'clara')
  session.edit({ turn: 2, beliefs: [{ character: 'clara', kind: 'belief', text: 'Harlan took the boat along the ridge path.', importance: 3 }] })
  happen(3, 'The boat is tied at the dock with the ridge path closed', 'clara')
  happen(3, 'Eleanor asks for the keys', 'eleanor')
  happen(4, 'Eleanor waits', 'eleanor')
  happen(5, 'Eleanor leaves', 'eleanor')
  happen(6, 'Eleanor returns', 'eleanor')
})
afterEach(() => { session.close() })

const dockOf = (): number => session.events.perceivedBy(session.characters.findByName('Clara')[0]!.id).find(entry => entry.event.turn === 3)!.perception.id

let recorded: { site: DecisionSite; report: SiteReport }[]
beforeEach(() => { recorded = [] })

const run = async (options: { mode?: DecisionMode; service?: DecisionService; confidence?: number } = {}) => {
  const store = {
    story: session, time: () => ({ now: 0, zone: 'UTC' }), cast: () => [], recordActivity: () => undefined,
    settings: () => ({ ...DEFAULT_SETTINGS, reflection: { ...DEFAULT_SETTINGS.reflection, minNew: 1 }, decisions: { ...DEFAULT_SETTINGS.decisions, reflection: options.mode ?? 'llm', confidence: options.confidence ?? 0.7 } }),
    text: (id: string, variables?: Record<string, string>) => `${id}: ${variables?.['thing'] ?? ''}`,
    recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
  } as unknown as TurnStore
  const reflector = memoryReflector({ agentOf: () => ({}) as never, ...options.service === undefined ? {} : { decisions: () => options.service } })
  const job = { chat: 'c', turn: 7, reason: 'manual', store } as unknown as ReflectionJob
  return await reflector.reflect(job, new AbortController().signal)
}

describe('the reflector', () => {
  it('doubts a belief its check finds contradicted, in place of what the pass would do to it', async () => {
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'a closed path rules out the ridge', things: [dockOf()], verdict: 'contradicted' }
      if (task.prompt.includes('Character: Eleanor')) return { add: [], revise: [], drop: [] }
      return { add: [], revise: [], drop: [{ id: 1, perceptions: [dockOf()] }] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name).sort()).toEqual(['Clara', 'Eleanor'])
    const belief = session.memories.list(session.characters.findByName('Clara')[0]!.id)[0]!
    expect(belief.confidence).toBe('doubtful')
    expect(session.memories.evidenceOf(belief.id).map(entry => entry.relation)).toEqual(['contradicts'])
  })

  it('mends what is only mechanically wrong instead of failing the pass', async () => {
    answer = (task) => (task.prompt.includes('A belief held by')
      ? { reason: 'they agree', things: [], verdict: 'consistent' }
      : { add: [{ kind: 'belief', text: 'Eleanor wants the keys.', importance: 3, confidence: 'sure', perceptions: [3, 4, 9999] }], revise: [{ id: 404, importance: 2 }], drop: [] })
    const { characters } = await run()
    expect(characters).toHaveLength(2)
  })

  it('goes on with the others when one cannot be sorted, tries it again next time, and says so', async () => {
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'they agree', things: [], verdict: 'consistent' }
      if (task.prompt.includes('Character: Clara')) throw new Error('the model did not stop')
      return { add: [], revise: [], drop: [] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name)).toEqual(['Eleanor'])
    expect(JSON.stringify(session.metadata.getValue('reflection.error'))).toContain('Clara could not be sorted this time')
    expect(session.metadata.getValue('reflection.cursor')).not.toHaveProperty('clara')
  })

  it('tries a character again with the older half of what it took in when the first try fails, and reaches only that far', async () => {
    for (let turn = 7; turn <= 16; turn += 1) session.edit({ turn, events: [{ turn, round: 1, text: `Clara sees thing ${turn}`, importance: 2, tags: [], involves: [], perceivedBy: [{ character: 'clara', mode: 'witnessed' as const, content: `thing ${turn}`, gist: `thing ${turn}` }] }] }, { seal: true })
    const sizes: number[] = []
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'they agree', things: [], verdict: 'consistent' }
      if (task.prompt.includes('Character: Clara')) {
        sizes.push(task.prompt.split('\n').filter(line => line.startsWith('- p')).length)
        if (sizes.length === 1) throw new Error('the model did not stop')
      }
      return { add: [], revise: [], drop: [] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name)).toContain('Clara')
    expect(sizes[1]).toBeLessThan(sizes[0]!)
    const cursor = session.metadata.getValue('reflection.cursor') as Record<string, number>
    const newest = Math.max(...session.events.perceivedBy(session.characters.findByName('Clara')[0]!.id).map(entry => entry.perception.id))
    expect(cursor['clara']).toBeLessThan(newest)
  })

  it('fails when nobody could be sorted', async () => {
    answer = () => { throw new Error('the model did not answer') }
    await expect(run()).rejects.toThrow('the model did not answer')
  })
})

describe('the reflector with a decision model', () => {
  const asked: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[] = []
  /** Answers every thing it is asked about with the same probability. */
  const decider = (probability: number): DecisionService => ({
    decide: async (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => {
      asked.push({ state, questions })
      return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability }])), model: 'decide-1' }
    },
  }) as unknown as DecisionService
  const checks = (): number => prompts.filter(prompt => prompt.includes('A belief held by')).length
  const prompts: string[] = []
  const pass = (task: Task): unknown => {
    prompts.push(task.prompt)
    if (task.prompt.includes('A belief held by')) return { reason: 'a closed path rules out the ridge', things: [dockOf()], verdict: 'contradicted' }
    return { add: [], revise: [], drop: [] }
  }
  const clara = () => session.memories.list(session.characters.findByName('Clara')[0]!.id)[0]!
  beforeEach(() => { asked.length = 0; prompts.length = 0; answer = pass })

  it('raises a doubt from a thing the decision model is sure contradicts the belief, without a request to the language model, in decision mode', async () => {
    await run({ mode: 'decision', service: decider(0.97) })
    expect(checks()).toBe(0)
    expect(clara().confidence).toBe('doubtful')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.state).toMatchObject({ belief: 'Harlan took the boat along the ridge path.' })
    expect(Object.keys(asked[0]!.questions)).toContain(`p${dockOf()}`)
    expect(asked[0]!.questions[`p${dockOf()}`]!.instructions).toBe(`roleplay/decide-reflection: p${dockOf()}`)
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.decided > 0])).toEqual([['reflection', 'decision', true]])
  })

  it('raises no doubt from an answer the decision model is not sure of, and never asks about what came before the belief', async () => {
    await run({ mode: 'decision', service: decider(0.6) })
    expect(clara().confidence).not.toBe('doubtful')
    const beliefTurn = clara().turn
    for (const key of Object.keys(asked[0]!.questions)) expect(session.events.perceivedBy(session.characters.findByName('Clara')[0]!.id).find(entry => `p${entry.perception.id}` === key)!.event.turn, key).toBeGreaterThanOrEqual(beliefTurn)
  })

  it('asks the language model for what the decision model is unsure of, in hybrid mode', async () => {
    await run({ mode: 'hybrid', service: decider(0.6) })
    expect(checks()).toBe(1)
    expect(clara().confidence).toBe('doubtful')
    expect(recorded[0]!.report).toMatchObject({ mode: 'hybrid', escalated: 1 })
  })

  it('trusts a sure decision model in hybrid mode, and asks the language model nothing', async () => {
    await run({ mode: 'hybrid', service: decider(0.99) })
    expect(checks()).toBe(0)
    expect(clara().confidence).toBe('doubtful')
  })

  it('acts on the language model and records the decision model\'s disagreement, in shadow mode', async () => {
    answer = (task) => { prompts.push(task.prompt); return task.prompt.includes('A belief held by') ? { reason: 'they agree', things: [], verdict: 'consistent' } : { add: [], revise: [], drop: [] } }
    await run({ mode: 'shadow', service: decider(0.99) })
    expect(clara().confidence).not.toBe('doubtful')
    expect(recorded[0]!.report).toMatchObject({ mode: 'shadow', disagreed: 1 })
    expect(recorded[0]!.report.samples[0]).toMatchObject({ decision: true, llm: false, turn: 7 })
  })

  it('uses the language model for the check when there is no decision service', async () => {
    await run({ mode: 'decision' })
    expect(checks()).toBe(1)
    expect(clara().confidence).toBe('doubtful')
    expect(recorded[0]!.report).toMatchObject({ decided: 0, problem: expect.stringContaining('no decision service') })
    expect(recorded[0]!.report.fallbacks).toBe(recorded[0]!.report.items)
    expect(recorded[0]!.report.fallbacks).toBeGreaterThan(0)
  })

  it('leaves the language model alone in llm mode even when a decision service is there', async () => {
    const service = decider(0.99)
    await run({ mode: 'llm', service })
    expect(asked).toEqual([])
    expect(checks()).toBe(1)
  })
})
