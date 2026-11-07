import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GateMode } from '../../src/shared/decisions.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveDecisionService, liveStructured, newCounters, type LiveOptions } from './live.ts'
import { VARIABLE_CASES } from './variable-cases.ts'
import { ratio, runVariableCase, total, type VariableCaseResult } from './variables-harness.ts'

/**
 * The tracked-value benchmark, live: each case is one turn of a small story at planted starting values, run through the product's tracker (`decisions.variables`) with real models, and
 * scored on which values it changed (precision, recall) and whether the new value is what the case asks. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=vars-hybrid BENCH_MODE=hybrid npx vitest run tests/benchmark/variables.spec.ts
 *
 * Choices (environment) as for the check benchmark: BENCH_MODE llm|decision|hybrid, BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_ONLY and
 * BENCH_SKIP (case ids), BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'vars')
const mode = env('BENCH_MODE', 'hybrid') as GateMode
const only = process.env['BENCH_ONLY']?.split(',')
const skip = process.env['BENCH_SKIP']?.split(',') ?? []
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  ...mode === 'llm' || mode === 'off' ? {} : { decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: mode as 'decision' | 'hybrid', confidence: 0.7 } },
  concurrency: 1,
}

const results: (VariableCaseResult & { run: number; counters: ReturnType<typeof newCounters> })[] = []

function summarise(): Record<string, unknown> {
  const all = total(results)
  const clean = results.filter(result => result.kind === 'keep')
  const kinds = ['number', 'flag', 'choice'] as const
  const sum = (pick: (result: (typeof results)[number]) => number): number => results.reduce((count, result) => count + pick(result), 0)
  return {
    label, mode, options: { llm: options.llm.model, temperature: options.llm.temperature, decision: options.decision },
    cases: results.length, passed: all.passed, precision: ratio(all.tp, all.tp + all.fp), recall: ratio(all.tp, all.tp + all.fn), tp: all.tp, fn: all.fn, fp: all.fp,
    tolerated: sum(result => result.tolerated), refusedEdits: sum(result => result.problems.length),
    valueAccuracy: ratio(all.tp - all.valueWrong, all.tp), valueWrong: all.valueWrong,
    falseAlarms: { cases: clean.length, alarmed: clean.filter(result => result.fp > 0).length },
    byKind: Object.fromEntries(kinds.map((kind) => {
      const items = results.flatMap(result => result.items.filter(item => item.kind === kind))
      const tp = items.filter(item => item.expected !== undefined && item.changed).length
      const fp = items.filter(item => item.expected === undefined && item.changed && item.tolerated !== true).length
      const fn = items.filter(item => item.expected !== undefined && !item.changed).length
      return [kind, { items: items.length, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) }]
    })),
    cost: {
      seconds: Math.round(sum(result => result.ms) / 1000), llmCalls: sum(result => result.counters.llmCalls), llmRetries: sum(result => result.counters.llmRetries), decisionCalls: sum(result => result.counters.decisionCalls),
      inputTokens: sum(result => result.counters.inputTokens), outputTokens: sum(result => result.counters.outputTokens), failedJobs: sum(result => result.counters.failures.length),
      escalated: sum(result => result.decisions.reduce((count, entry) => count + entry.report.escalated, 0)), decided: sum(result => result.decisions.reduce((count, entry) => count + entry.report.decided, 0)),
    },
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `variables-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe.skipIf(!live)(`the tracked-value benchmark, live (${label}, ${mode})`, () => {
  for (const language of languages) {
    for (const benchmark of VARIABLE_CASES.filter(candidate => (only === undefined || only.includes(candidate.id)) && !skip.includes(candidate.id))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${benchmark.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const counters = newCounters()
          const result = await runVariableCase(benchmark, language, {
            mode, ask: liveStructured(options, counters), ...options.decision === undefined ? {} : { decisions: liveDecisionService(options.decision, counters) as never },
          })
          results.push({ ...result, run, counters })
          expect(results.at(-1)?.case).toBe(benchmark.id)
        }, 600_000)
      }
    }
  }
})
