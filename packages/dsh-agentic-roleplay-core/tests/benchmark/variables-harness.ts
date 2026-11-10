import { createSessionStore } from '@dsh-agentic-roleplay/state'
import type { DecisionService } from '@dsh-ai-providers/core'
import type { VariableValue } from 'dsh-roleplay-model'
import { shippedText } from '../../src/host/prompts/library.ts'
import type { TrackJob, TurnStore } from '../../src/host/orchestration/boundaries.ts'
import type { DecisionSite, GateMode, SiteReport } from '../../src/shared/decisions.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { trackedItems, variableTracker } from '../../src/host/variables/tracker.ts'
import type { Language } from './language.ts'
import { Trace } from './trace.ts'
import { CAST_KEYS, PLAYER, castName, startValue, valueOk, variableDefinitions, type ValueCheck, type VariableCase } from './variable-cases.ts'

export interface ItemResult {
  key: string
  kind: 'number' | 'flag' | 'choice'
  started: VariableValue
  got: VariableValue
  changed: boolean
  expected?: ValueCheck
  /** Changed without being asked for, in a case that allows it. */
  tolerated?: true
  /** For an expected and detected change: whether the new value is what the case asks. */
  valueOk?: boolean
}

export interface VariableCaseResult {
  case: string
  kind: VariableCase['kind']
  language: Language
  ms: number
  items: ItemResult[]
  tp: number
  fn: number
  fp: number
  /** Changes the case did not ask for and allowed. */
  tolerated: number
  valueWrong: number
  decisions: { site: DecisionSite; report: SiteReport }[]
  problems: string[]
}

export interface VariableDeps {
  mode: GateMode
  /** The language model's answer to a request with a result schema. */
  ask: (request: { persona: string; prompt: string; result: unknown; label: string }) => Promise<unknown>
  decisions?: DecisionService
  /** Where the run's state and verdicts are written; the model's requests are written by whoever made `ask`. */
  trace?: Trace
}

const signal = new AbortController().signal

/** Runs the product's tracker on one case: a story at the case's starting values, one turn, and what each value ended as. */
export async function runVariableCase(benchmark: VariableCase, language: Language, deps: VariableDeps): Promise<VariableCaseResult> {
  const session = createSessionStore(':memory:', { id: `bench-${benchmark.id}`, name: benchmark.id, world: { id: 'bench', name: 'Bench' } })
  const decisions: VariableCaseResult['decisions'] = []
  const problems: string[] = []
  try {
    for (const key of CAST_KEYS) {
      session.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === PLAYER ? 'playable' : 'npc', control: key === PLAYER ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    }
    const defs = variableDefinitions(language).map(definition => session.variables.define(definition))
    for (const [item, given] of Object.entries(benchmark.start ?? {})) {
      const [variable, subject] = item.split(':') as [string, string]
      const def = defs.find(candidate => candidate.key === variable)!
      session.variables.set(variable, def.subject, subject === 'world' ? 0 : session.characters.getBySourceId(subject)!.id, { value: startValue(given, language) }, 0)
    }
    const settings = { ...DEFAULT_SETTINGS, prompts: { ...DEFAULT_SETTINGS.prompts, language }, decisions: { ...DEFAULT_SETTINGS.decisions, variables: deps.mode } }
    const store = {
      story: session,
      cast: () => session.characters.list().map(character => ({ key: character.sourceId, character })),
      settings: () => settings,
      text: (id: string, variables: Record<string, string> = {}) => shippedText(id, language, variables),
      recordDecisions: (site: DecisionSite, report: SiteReport) => { decisions.push({ site, report }) },
    } as unknown as TurnStore
    const trace = deps.trace ?? Trace.off
    const turn = benchmark.turn(language)
    trace.state('setup', { case: benchmark.id, language, kind: benchmark.kind, mode: deps.mode, start: benchmark.start ?? {}, expect: benchmark.expect, allow: benchmark.allow ?? [], input: turn.input, deeds: turn.deeds, narration: turn.narration })
    const job: TrackJob = { chat: 'bench', turn: 4, store, input: turn.input, deeds: turn.deeds, narration: turn.narration }
    const scene = `${job.input}\n${job.deeds.join('\n')}\n${job.narration}`
    const before = trackedItems(store, scene)
    trace.state('asked-about', before.map(item => ({ key: item.key, kind: item.variable.kind, value: item.value })))
    const tracker = variableTracker({
      agentOf: () => undefined, problem: (message) => { problems.push(message) }, ...deps.decisions === undefined ? {} : { decisions: () => deps.decisions },
      ask: deps.ask,
    })
    const began = Date.now()
    await tracker.track(job, signal)
    const ms = Date.now() - began
    trace.state('tracker', { decisions, problems, ms })
    const after = new Map(trackedItems(store, scene).map(item => [item.key, item.value]))
    const items = before.map((item): ItemResult => {
      const got = after.get(item.key)!
      const changed = got !== item.value
      const expected = benchmark.expect[item.key]
      return { key: item.key, kind: item.variable.kind, started: item.value, got, changed, ...expected === undefined ? {} : { expected }, ...expected !== undefined && changed ? { valueOk: valueOk(expected, item.value, got, language) } : {}, ...expected === undefined && changed && (benchmark.allow ?? []).includes(item.key) ? { tolerated: true as const } : {} }
    })
    for (const item of items) {
      const asked = item.expected !== undefined
      const held = asked ? item.changed && item.valueOk !== false : !item.changed || (benchmark.allow ?? []).includes(item.key)
      trace.expect(item.key, held, { started: item.started, got: item.got, expected: item.expected, changed: item.changed, valueOk: item.valueOk })
    }
    return {
      case: benchmark.id, kind: benchmark.kind, language, ms, items, decisions, problems,
      tp: items.filter(item => item.expected !== undefined && item.changed).length,
      fn: items.filter(item => item.expected !== undefined && !item.changed).length,
      fp: items.filter(item => item.expected === undefined && item.changed && !(benchmark.allow ?? []).includes(item.key)).length,
      tolerated: items.filter(item => item.expected === undefined && item.changed && (benchmark.allow ?? []).includes(item.key)).length,
      valueWrong: items.filter(item => item.valueOk === false).length,
    }
  } finally { session.close() }
}

export interface Totals { tp: number; fn: number; fp: number; valueWrong: number; cases: number; passed: number }

export function total(results: readonly VariableCaseResult[]): Totals {
  return results.reduce<Totals>((sum, result) => ({
    tp: sum.tp + result.tp, fn: sum.fn + result.fn, fp: sum.fp + result.fp, valueWrong: sum.valueWrong + result.valueWrong, cases: sum.cases + 1,
    passed: sum.passed + (result.fn === 0 && result.fp === 0 && result.valueWrong === 0 ? 1 : 0),
  }), { tp: 0, fn: 0, fp: 0, valueWrong: 0, cases: 0, passed: 0 })
}

export const ratio = (top: number, bottom: number): number | undefined => (bottom === 0 ? undefined : top / bottom)
