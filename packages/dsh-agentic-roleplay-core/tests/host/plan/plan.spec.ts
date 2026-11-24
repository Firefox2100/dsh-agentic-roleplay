import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { parsePlan } from '../../../src/shared/plan.ts'
import type { PlanJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

let answer: Record<string, unknown>
let refusals: (string | undefined)[]
let asked: { prompt: string; beforeSubmit?: (value: unknown) => string | undefined }[]
vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: { prompt: string; beforeSubmit?: (value: unknown) => string | undefined }) => {
    asked.push(task)
    let refused = task.beforeSubmit?.(answer)
    refusals.push(refused)
    if (refused !== undefined) { refused = task.beforeSubmit?.(answer); refusals.push(refused) }
    if (refused !== undefined) throw new Error(refused)
    return answer
  },
  childModel: () => ({}), childSampling: () => ({}), childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string) => `persona of ${id}` }))

const { planDue, readPlan, writePlan } = await import('../../../src/host/plan/plan.ts')
const { storyPlanner } = await import('../../../src/host/plan/planner.ts')

let session: SessionStore
beforeEach(() => {
  asked = []
  refusals = []
  answer = {}
  session = createSessionStore(':memory:', { id: 'plan', name: 'Plan', world: { id: 'w', name: 'W' } })
})
afterEach(() => { session.close() })

const settings = { minTurns: 3, everyTurns: 8 }
const trigger = (key: string) => ({ key, name: key, when: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: `${key} happens.` }] })
const stored = (turn: number, triggers: string[] = []) => writePlan(session, { turn, note: 'Keep the harbor in view.', items: [{ text: 'The guild closes the harbor.', overturnedBy: 'the player wins the harbor master over', triggers }] })

describe('a stored plan', () => {
  it('is read back as written, with what is not in the form left out, and is none for anything else', () => {
    stored(2, ['dusk'])
    expect(readPlan(session)).toEqual({ turn: 2, note: 'Keep the harbor in view.', items: [{ text: 'The guild closes the harbor.', overturnedBy: 'the player wins the harbor master over', triggers: ['dusk'] }] })
    expect(parsePlan({ turn: 1, items: [{ text: ' ' }, { text: 'Kept', triggers: [1, 'a'] }, 7], note: 4 })).toEqual({ turn: 1, note: '', items: [{ text: 'Kept', overturnedBy: '', triggers: ['a'] }] })
    expect(parsePlan('nope')).toBeUndefined()
    expect(parsePlan({ items: [] })).toBeUndefined()
  })
})

describe('when the plan needs a look', () => {
  it('asks for the first plan once the story has begun, and not before', () => {
    expect(planDue(session, 2, settings)).toBeUndefined()
    expect(planDue(session, 3, settings)).toBe('first')
  })

  it('waits while nothing has changed, and asks again after the number of turns without a look', () => {
    stored(2)
    expect(planDue(session, 9, settings)).toBeUndefined()
    expect(planDue(session, 10, settings)).toBe('periodic')
  })

  it('asks at once when a trigger the plan made is no longer waiting', () => {
    session.triggers.add({ key: 'dusk', name: 'dusk', condition: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: 'Dusk.' }], repeat: false, priority: 0 }, 'story', 2)
    stored(2, ['dusk'])
    expect(planDue(session, 4, settings)).toBeUndefined()
    session.triggers.update(session.triggers.getByKey('dusk')!.id, { status: 'fired' })
    expect(planDue(session, 4, settings)).toBe('changed')
  })

  it('asks at once when a thread was settled after the plan was made, and not for one settled before', () => {
    const early = session.threads.open('The missing ledger', 1)
    session.threads.resolve(early.id, 1)
    stored(2)
    expect(planDue(session, 4, settings)).toBeUndefined()
    const later = session.threads.open('The locked cellar', 2)
    session.threads.resolve(later.id, 3)
    expect(planDue(session, 4, settings)).toBe('changed')
  })
})

const store = (): TurnStore => ({
  settings: () => ({ ...DEFAULT_SETTINGS, plan: { ...DEFAULT_SETTINGS.plan, auto: true } }),
  story: session,
  time: () => ({ now: Date.UTC(1912, 9, 5, 12), zone: 'UTC' }),
  pins: () => ['~The story heads toward the harbor.'],
}) as unknown as TurnStore
const job = (turn = 5): PlanJob => ({ chat: 'c', turn, store: store(), reason: 'the story has begun and has no plan yet' })
const keeper = () => storyPlanner({ agentOf: () => ({}) as never })
const signal = new AbortController().signal

describe('the planner', () => {
  it('writes the plan it is given, makes the beats it asks for and keeps only the triggers that exist', async () => {
    answer = { items: [{ text: 'The guild closes the harbor.', overturned_by: 'the harbor master is won over', trigger_keys: ['dusk', 'nothing'] }], note: 'Let the closure be felt.', triggers: [trigger('dusk')] }
    const report = await keeper().keep(job(), signal)
    expect(report).toEqual({ changed: true, made: ['dusk'], failed: [], cancelled: [] })
    expect(readPlan(session)).toEqual({ turn: 5, note: 'Let the closure be felt.', items: [{ text: 'The guild closes the harbor.', overturnedBy: 'the harbor master is won over', triggers: ['dusk'] }] })
    expect(session.triggers.getByKey('dusk')).toMatchObject({ origin: 'story', status: 'dormant', createdTurn: 5 })
    expect(asked[0]!.prompt).toContain('There is no plan yet: make one.')
    expect(asked[0]!.prompt).toContain('The story heads toward the harbor.')
  })

  it('refuses a trigger that would change the records, so a plan only ever leans on the story', async () => {
    answer = { items: [], note: '', triggers: [{ ...trigger('hard'), effects: [{ type: 'edit', edit: { turn: 1 } }] }] }
    await expect(keeper().keep(job(), signal)).rejects.toThrow('which a plan may not do')
    expect(session.triggers.getByKey('hard')).toBeUndefined()
    expect(readPlan(session)).toBeUndefined()
  })

  it('sends a trigger the story would refuse back once with the reasons, and then keeps the plan and leaves that trigger out', async () => {
    answer = { items: [{ text: 'One thing.' }], note: 'n', triggers: [trigger('a'), { key: 'b', name: 'b', when: { type: 'nonsense' }, effects: [{ type: 'beat', text: 'x' }] }] }
    const report = await keeper().keep(job(), signal)
    expect(refusals[0]).toContain('trigger b:')
    expect(refusals[1]).toBeUndefined()
    expect(report.made).toEqual(['a'])
    expect(report.failed).toHaveLength(1)
    expect(readPlan(session)!.items).toHaveLength(1)
  })

  it('sends back an item that makes the player\'s character act once, and then leaves that item out of the plan, keeping a consequence of the player\'s own choice', async () => {
    answer = { items: [{ text: 'The player\'s character walks to the pier.', forces_player: true }, { text: 'If the player\'s character goes out in the rain, a cold follows.', forces_player: false }], note: 'n' }
    await keeper().keep(job(), signal)
    expect(refusals[0]).toContain('item 1')
    expect(refusals[1]).toBeUndefined()
    expect(readPlan(session)!.items.map(item => item.text)).toEqual(['If the player\'s character goes out in the rain, a cold follows.'])
  })

  it('makes no more triggers than one look may', async () => {
    answer = { items: [{ text: 'One thing.' }], note: 'n', triggers: [trigger('a'), trigger('b'), trigger('c')] }
    const report = await keeper().keep(job(), signal)
    expect(report.made).toEqual(['a', 'b'])
    expect(session.triggers.getByKey('c')).toBeUndefined()
    expect(readPlan(session)!.items).toHaveLength(1)
  })

  it('only confirms an unchanged plan, and withdraws a waiting trigger of its own that the story has overtaken', async () => {
    answer = { items: [{ text: 'The guild closes the harbor.' }], note: 'n', triggers: [trigger('dusk')] }
    await keeper().keep(job(5), signal)
    answer = { unchanged: true, cancel: ['dusk', 'unknown'] }
    const report = await keeper().keep(job(9), signal)
    expect(report).toEqual({ changed: false, made: [], failed: [], cancelled: ['dusk'] })
    expect(readPlan(session)!.turn).toBe(9)
    expect(readPlan(session)!.items).toHaveLength(1)
    expect(session.triggers.getByKey('dusk')!.status).toBe('expired')
  })
})
