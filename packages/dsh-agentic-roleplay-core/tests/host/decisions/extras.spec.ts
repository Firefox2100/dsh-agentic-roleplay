import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { DecisionSite, ExtraMode, SiteReport } from '../../../src/shared/decisions.ts'
import type { GateJob, RuleJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

vi.mock('../../../src/host/agents/child.ts', () => ({ runChild: async () => { throw new Error('the language model is never asked for an extra') }, childModel: () => ({}), childSampling: () => ({}), childTrace: () => undefined }))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string) => `persona of ${id}` }))

const { outputGates } = await import('../../../src/host/decisions/gates.ts')
const { ruleChecks, hiddenFrom, MAX_SECRETS } = await import('../../../src/host/decisions/extras.ts')

let recorded: { site: DecisionSite; report: SiteReport }[]
let states: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[]

/** A decision service whose answer for each question is looked up by what the question says. */
const decider = (probability: (instructions: string) => number): DecisionService => ({
  decide: async (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => {
    states.push({ state, questions })
    return { answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, { type: 'noul', probability: probability(question.instructions) }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

beforeEach(() => { recorded = []; states = [] })

const store = (extras: { rules?: ExtraMode; secrets?: ExtraMode }, rules: string[] = []): TurnStore => ({
  settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, rules: extras.rules ?? 'off', secrets: extras.secrets ?? 'off' } }),
  text: (id: string, variables?: Record<string, string>) => `${id} ${JSON.stringify(variables ?? {})}`,
  rules: () => rules,
  recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
}) as unknown as TurnStore

const signal = new AbortController().signal
const ruleJob = (extras: { rules?: ExtraMode }, rules: string[], input = 'I cast a fireball.'): RuleJob => ({ chat: 'c', turn: 3, input, player: 'Arthur', store: store(extras, rules) })

describe('the rule check', () => {
  const rules = ['There is no magic.', 'Nobody can fly.']

  it('asks nothing and records nothing while it is off, when there are no rules, and when the player wrote nothing', async () => {
    const service = decider(() => 0.99)
    const check = ruleChecks({ decisions: () => service })
    expect(await check.check(ruleJob({ rules: 'off' }, rules), signal)).toEqual([])
    expect(await check.check(ruleJob({ rules: 'on' }, []), signal)).toEqual([])
    expect(await check.check(ruleJob({ rules: 'on' }, rules, '  '), signal)).toEqual([])
    expect([states, recorded]).toEqual([[], []])
  })

  it('puts the action against every rule in one request, and returns the rules the decision model finds broken', async () => {
    const service = decider(instructions => (instructions.includes('no magic') ? 0.9 : 0.05))
    const found = await ruleChecks({ decisions: () => service }).check(ruleJob({ rules: 'on' }, rules), signal)
    expect(found).toEqual(['There is no magic.'])
    expect(states).toHaveLength(1)
    expect(states[0]!.state).toEqual({ player_character: 'Arthur', player_message: 'I cast a fireball.' })
    expect(Object.keys(states[0]!.questions)).toHaveLength(2)
    expect(Object.values(states[0]!.questions)[1]!.instructions).toBe('roleplay/check-rule {"rule":"Nobody can fly."}')
    expect(recorded.map(entry => [entry.site, entry.report.mode, entry.report.items, entry.report.decided])).toEqual([['rules', 'decision', 2, 2]])
  })

  it('finds nothing and says why, once, when no decision service can be used', async () => {
    const said: string[] = []
    const check = ruleChecks({ problem: message => said.push(message) })
    expect(await check.check(ruleJob({ rules: 'on' }, rules), signal)).toEqual([])
    expect(await check.check(ruleJob({ rules: 'on' }, rules), signal)).toEqual([])
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('nothing was checked')
    expect(recorded.map(entry => entry.report.problem)).toEqual([expect.stringContaining('no decision service'), expect.stringContaining('no decision service')])
  })

  it('finds nothing when the service fails, and does not stop the turn', async () => {
    const broken = { decide: async () => { throw new Error('boom') } } as unknown as DecisionService
    expect(await ruleChecks({ decisions: () => broken }).check(ruleJob({ rules: 'on' }, rules), signal)).toEqual([])
    expect(recorded[0]!.report.problem).toBe('boom')
  })
})

const secretJob = (extras: { secrets?: ExtraMode }, secrets: { title: string; text: string }[]): GateJob => ({
  chat: 'c', turn: 4, input: 'I open the vault.', player: 'Arthur', narration: 'The vault opens.', passage: 'The vault opens. Clara: "The mayor poisoned the well."',
  secrets, store: store(extras),
})

describe('the secrets check', () => {
  const secrets = [{ title: 'The well', text: 'The mayor poisoned the well.' }, { title: 'The key', text: 'The key is under the stone.' }]

  it('is not asked while it is off or when there is nothing hidden', async () => {
    const service = decider(() => 0.99)
    expect(await outputGates({ agentOf: () => undefined, decisions: () => service }).check(secretJob({ secrets: 'off' }, secrets), signal)).toEqual([])
    expect(await outputGates({ agentOf: () => undefined, decisions: () => service }).check(secretJob({ secrets: 'on' }, []), signal)).toEqual([])
    expect([states, recorded]).toEqual([[], []])
  })

  it('asks one question for each hidden fact about the passage, and names the facts it finds given away', async () => {
    const service = decider(instructions => (instructions.includes('poisoned') ? 0.8 : 0.1))
    const found = await outputGates({ agentOf: () => undefined, decisions: () => service }).check(secretJob({ secrets: 'on' }, secrets), signal)
    expect(found).toEqual([{ gate: 'secrets', message: expect.stringContaining('(The well)') }])
    expect(found[0]!.message).not.toContain('under the stone')
    expect(states[0]!.state).toEqual({ passage: 'The vault opens. Clara: "The mayor poisoned the well."' })
    expect(Object.values(states[0]!.questions).map(question => question.instructions)).toEqual(['roleplay/gate-secret {"secret":"The mayor poisoned the well."}', 'roleplay/gate-secret {"secret":"The key is under the stone."}'])
    expect(recorded.map(entry => entry.site)).toEqual(['secrets'])
  })

  it('lets the passage go as it is, and says so once, when no decision service can be used', async () => {
    const said: string[] = []
    const gate = outputGates({ agentOf: () => undefined, problem: message => said.push(message) })
    expect(await gate.check(secretJob({ secrets: 'on' }, secrets), signal)).toEqual([])
    expect(await gate.check(secretJob({ secrets: 'on' }, secrets), signal)).toEqual([])
    expect(said).toHaveLength(1)
  })
})

describe('the hidden lore of a character', () => {
  const entry = (id: number, title: string, scope: 'everyone' | 'listed', summary = `${title} summary`) => ({ id, title, scope, summary })
  const story = (entries: ReturnType<typeof entry>[], known: number[]) => ({ lore: { list: () => entries }, knowledge: { knows: (_c: number, kind: string, id: number) => kind === 'lore' && known.includes(id) } }) as unknown as TurnStore['story']

  it('is what is listed for others only and the character has no edge to', () => {
    const found = hiddenFrom(story([entry(1, 'Common', 'everyone'), entry(2, 'Known', 'listed'), entry(3, 'Hidden', 'listed'), entry(4, 'Blank', 'listed', ' ')], [2]), 9 as never, 'text')
    expect(found).toEqual([{ title: 'Hidden', text: 'Hidden summary' }])
  })

  it('asks first about a fact the passage names, and keeps the number it asks about within the limit', () => {
    const many = Array.from({ length: MAX_SECRETS + 4 }, (_, index) => entry(index + 1, `Matter ${String.fromCharCode(65 + index)}`, 'listed'))
    const found = hiddenFrom(story(many, []), 9 as never, 'Everyone talks about matter t.')
    expect(found).toHaveLength(MAX_SECRETS)
    expect(found[0]!.title).toBe('Matter T')
  })

  it('shows only the first 300 characters of a fact', () => {
    const found = hiddenFrom(story([entry(1, 'Long', 'listed', 'x'.repeat(500))], []), 9 as never, '')
    expect(found[0]!.text).toHaveLength(300)
  })
})
