import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import type { DecisionService } from '@dsh-ai-providers/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DecisionSite, GateMode, SiteReport } from '../../../src/shared/decisions.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { TrackJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { trackedItems, variableTracker } from '../../../src/host/variables/tracker.ts'

let session: SessionStore
let recorded: { site: DecisionSite; report: SiteReport }[]
let problems: string[]
let asked: { label: string; prompt: string; result: unknown }[]
const signal = new AbortController().signal

beforeEach(() => {
  recorded = []
  problems = []
  asked = []
  session = createSessionStore(':memory:', { id: 'track', name: 'Track', world: { id: 'w', name: 'W' } })
  for (const [sourceId, name] of [['arthur', 'Arthur'], ['clara', 'Clara']] as const) {
    session.characters.add({ sourceId, name, aliases: [], kind: 'person', tier: 'principal', role: sourceId === 'arthur' ? 'playable' : 'npc', control: sourceId === 'arthur' ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  }
  session.variables.define({ key: 'fatigue', name: 'Fatigue', description: 'How tired: 0 rested, 10 exhausted.', update: 'Rises by 1 for each hour of hard effort.', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 2, visibility: 'public' })
  session.variables.define({ key: 'unrest', name: 'Unrest', description: 'How close the town is to trouble.', kind: 'number', subject: 'world', min: 0, max: 10, integer: true, default: 3, visibility: 'public' })
})
afterEach(() => { session.close() })

const store = (mode: GateMode): TurnStore => ({
  story: session,
  cast: () => session.characters.list().map(character => ({ key: character.sourceId, character })),
  settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, variables: mode } }),
  text: (id: string, variables: Record<string, string> = {}) => `${id}: ${Object.values(variables).join(' | ')}`,
  recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
}) as unknown as TurnStore

const job = (mode: GateMode): TrackJob => ({ chat: 'c', turn: 4, store: store(mode), input: 'I haul crates.', deeds: ['Arthur: hauls crates for an hour', 'Clara: watches'], narration: 'Arthur hauls crates until his arms shake.' })

const decider = (probability: (key: string) => number): DecisionService => ({
  decide: async (_state: unknown, questions: Record<string, unknown>) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability: probability(key) }])), model: 'decide-1' }),
}) as unknown as DecisionService

const tracker = (answers: { verdicts?: Record<string, boolean>; values?: Record<string, unknown> }, decisions?: DecisionService) => variableTracker({
  agentOf: () => undefined, problem: message => { problems.push(message) }, ...decisions === undefined ? {} : { decisions: () => decisions },
  ask: async ({ label, prompt, result }) => {
    asked.push({ label, prompt, result })
    return label === 'tracked values'
      ? { ...Object.fromEntries(Object.keys(answers.verdicts ?? {}).map(key => [key, false])), ...answers.verdicts }
      : { ...answers.values }
  },
})

const value = (key: string, subject: string): unknown => session.variables.value(key, subject === 'world' ? 'world' : 'character', subject === 'world' ? 0 : session.characters.getBySourceId(subject)!.id)

describe('the values to look at', () => {
  it('are each declared value for the world and for each character of the scene it applies to, never the built-in feelings', () => {
    expect(trackedItems(store('llm'), 'Clara nods.').map(item => item.key)).toEqual(['fatigue:arthur', 'fatigue:clara', 'unrest:world'])
    expect(trackedItems(store('llm'), 'Nobody else is mentioned.').map(item => item.key)).toEqual(['fatigue:arthur', 'unrest:world'])
  })
})

describe('looking at the tracked values after a turn', () => {
  it('does nothing while it is off', async () => {
    expect(await tracker({}).track(job('off'), signal)).toBe(0)
    expect(asked).toEqual([])
  })

  it('asks for the new values in a schema that types each changed key by what the value is', async () => {
    session.variables.define({ key: 'wounded', name: 'Wounded', description: 'Whether hurt.', kind: 'flag', subject: 'character', default: false, visibility: 'public' })
    session.variables.define({ key: 'mood', name: 'Mood', description: 'How the town feels.', kind: 'choice', subject: 'world', options: ['calm', 'tense'], default: 'calm', visibility: 'public' })
    await tracker({ verdicts: { 'fatigue:arthur': true, 'wounded:arthur': true, 'mood:world': true }, values: { 'fatigue:arthur': 5, 'wounded:arthur': true, 'mood:world': 'tense' } }).track(job('llm'), signal)
    expect(asked[1]!.result).toEqual({
      type: 'object', additionalProperties: false, required: ['fatigue:arthur', 'wounded:arthur', 'mood:world'],
      properties: { 'fatigue:arthur': { type: 'integer' }, 'wounded:arthur': { type: 'boolean' }, 'mood:world': { type: 'string', enum: ['calm', 'tense'] } },
    })
    expect(value('mood', 'world')).toBe('tense')
  })

  it('asks the language model about every value in one request, and then for the new value of those that changed only', async () => {
    const set = await tracker({ verdicts: { 'fatigue:arthur': true, 'fatigue:clara': false, 'unrest:world': false }, values: { 'fatigue:arthur': 5 } }).track(job('llm'), signal)
    expect(set).toBe(1)
    expect(asked.map(entry => entry.label)).toEqual(['tracked values', 'new values'])
    expect(asked[0]!.prompt).toContain('- fatigue:clara: Clara, Fatigue (0 to 10, whole numbers)')
    expect(asked[0]!.prompt).toContain('Changes: Rises by 1 for each hour of hard effort.')
    expect(asked[0]!.prompt).not.toContain('Changes: ' + 'How close')
    expect(asked[1]!.prompt).toContain('fatigue:arthur')
    expect(asked[1]!.prompt).not.toContain('fatigue:clara')
    expect(value('fatigue', 'arthur')).toBe(5)
    expect(value('fatigue', 'clara')).toBe(2)
    expect(recorded.map(entry => entry.site)).toEqual(['variables'])
  })

  it('lets the decision model screen each value, and asks the language model for the new value of the ones it says changed', async () => {
    const set = await tracker({ values: { 'fatigue:arthur': 6, 'unrest:world': 9 } }, decider(key => (key === 'fatigue:arthur' ? 0.95 : 0.05))).track(job('decision'), signal)
    expect(set).toBe(1)
    expect(asked.map(entry => entry.label)).toEqual(['new values'])
    expect(value('fatigue', 'arthur')).toBe(6)
    expect(value('unrest', 'world')).toBe(3)
  })

  it('sets nothing, and reports why, for a value the story would refuse, and does not set one that was not changed or is what it already is', async () => {
    const set = await tracker({ verdicts: { 'fatigue:arthur': true, 'fatigue:clara': true, 'unrest:world': true }, values: { 'fatigue:arthur': 99, 'fatigue:clara': 2, 'unrest:world': 4, 'nope:world': 1 } }).track(job('llm'), signal)
    expect(set).toBe(1)
    expect(value('fatigue', 'arthur')).toBe(2)
    expect(value('unrest', 'world')).toBe(4)
    expect(problems.join('\n')).toContain('fatigue:arthur')
  })

  it('goes to the language model for everything when the decision model cannot be used, and says nothing is wrong with the story', async () => {
    const set = await tracker({ verdicts: { 'fatigue:arthur': true }, values: { 'fatigue:arthur': 4 } }).track(job('decision'), signal)
    expect(set).toBe(1)
    expect(recorded[0]!.report.fallbacks).toBe(3)
  })

  it('leaves the values as they were when the language model fails', async () => {
    const failing = variableTracker({ agentOf: () => undefined, problem: message => { problems.push(message) }, ask: () => Promise.reject(new Error('the model is down')) })
    expect(await failing.track(job('llm'), signal)).toBe(0)
    expect(problems.join('\n')).toContain('the model is down')
    expect(value('fatigue', 'arthur')).toBe(2)
  })
})
