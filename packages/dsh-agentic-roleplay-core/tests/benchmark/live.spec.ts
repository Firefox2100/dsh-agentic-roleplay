import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { loadCardEvidence } from '../../src/host/checks/card-evidence.ts'
import { runChecks } from '../../src/host/checks/run.ts'
import type { BenchCase } from './cases.ts'
import { CODE_CASES, FIDELITY_CODE_CASES, UPDATE_CASES } from './cases.ts'
import { ALL_JUDGED } from './judged-cases.ts'
import type { Language } from './language.ts'
import { LANGUAGES } from './language.ts'
import { liveContext, newCounters, type DecisionMode, type LiveOptions } from './live.ts'
import { NONE, add, precision, recall, score, type Scored, type Totals } from './score.ts'
import { SALT_HARBOR_ID } from './salt-harbor.ts'
import { tempWorld } from './write.ts'

/**
 * The live benchmark: every case of the benchmark worlds run with real models, in both languages, scored against what each case plants. It needs the services of the
 * development machine (a language model, an embedding model and a decision model on LocalAI), so it runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=qwen35b-llm BENCH_MODE=llm npx vitest run tests/benchmark/live.spec.ts
 *
 * Choices (environment): BENCH_MODE llm|decision|hybrid, BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_EMBED_MODEL, BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_CONFIDENCE,
 * BENCH_ONLY and BENCH_SKIP (case ids), BENCH_LANGS (en,zh), BENCH_REPEAT (runs of each case), BENCH_CONCURRENCY, BENCH_OUT (folder for the result file).
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'run')
const mode = env('BENCH_MODE', 'llm') as DecisionMode
const only = process.env['BENCH_ONLY']?.split(',')
const skip = process.env['BENCH_SKIP']?.split(',') ?? []
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  embed: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_EMBED_MODEL', 'bge-m3') },
  ...mode === 'llm' ? {} : { decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode, confidence: Number(env('BENCH_CONFIDENCE', '0.7')) } },
  concurrency: Number(env('BENCH_CONCURRENCY', '2')),
}

interface Result {
  case: string
  kind: BenchCase['kind']
  language: Language
  run: number
  ms: number
  scored: Scored
  findings: { check: string; code: string; where: string }[]
  skipped: { check: string; reason: string }[]
  counters: ReturnType<typeof newCounters>
}

const results: Result[] = []

function summarise(): Record<string, unknown> {
  const byCheck = new Map<string, Totals>()
  for (const result of results) {
    const checks = new Set([...result.scored.tp.map(entry => entry.check), ...result.scored.fn.map(entry => entry.check), ...result.scored.fp.map(entry => entry.check)])
    for (const check of checks) {
      const own: Scored = { tp: result.scored.tp.filter(entry => entry.check === check), fn: result.scored.fn.filter(entry => entry.check === check), fp: result.scored.fp.filter(entry => entry.check === check), tolerated: 0 }
      byCheck.set(check, add(byCheck.get(check) ?? NONE, own))
    }
  }
  const all = results.reduce<Totals>((totals, result) => add(totals, result.scored), NONE)
  const clean = results.filter(result => result.kind !== 'defect')
  const sum = (pick: (result: Result) => number): number => results.reduce((total, result) => total + pick(result), 0)
  const llmCalls = sum(result => result.counters.llmCalls)
  return {
    label, mode, options: { llm: options.llm.model, temperature: options.llm.temperature, decision: options.decision, embed: options.embed?.model },
    cases: results.length, passed: all.passed, precision: precision(all), recall: recall(all), tp: all.tp, fn: all.fn, fp: all.fp,
    falseAlarms: { cases: clean.length, alarmed: clean.filter(result => result.scored.fp.length > 0).length },
    byCheck: Object.fromEntries([...byCheck].map(([check, totals]) => [check, { ...totals, precision: precision(totals), recall: recall(totals) }])),
    cost: {
      seconds: Math.round(sum(result => result.ms) / 1000), llmCalls, llmRetries: sum(result => result.counters.llmRetries), yesNoCalls: sum(result => result.counters.yesNoCalls),
      decisionCalls: sum(result => result.counters.decisionCalls), decisionSeconds: Math.round(sum(result => result.counters.decisionMs) / 1000), embedCalls: sum(result => result.counters.embedCalls),
      inputTokens: sum(result => result.counters.inputTokens), outputTokens: sum(result => result.counters.outputTokens), failedJobs: sum(result => result.counters.failures.length),
      // a yes-or-no that went to the language model although a decision model was asked first: it was unsure
      fallbackShare: options.decision === undefined ? undefined : (sum(result => result.counters.decisionCalls) === 0 ? undefined : Math.min(1, sum(result => result.counters.yesNoCalls) / sum(result => result.counters.decisionCalls))),
    },
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `checks-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

const cases: BenchCase[] = [...(process.env['BENCH_CODE'] === undefined ? [] : [...CODE_CASES, ...FIDELITY_CODE_CASES, ...UPDATE_CASES]), ...ALL_JUDGED].filter(benchmark => (only === undefined || only.includes(benchmark.id)) && !skip.includes(benchmark.id))

describe.skipIf(!live)(`the live benchmark (${label}, ${mode})`, () => {
  for (const language of languages) {
    for (const benchmark of cases) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${benchmark.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const world = await tempWorld(benchmark.build(language), { id: SALT_HARBOR_ID[language], name: benchmark.id })
          const counters = newCounters()
          const began = Date.now()
          try {
            const card = benchmark.card === undefined ? undefined : await loadCardEvidence(world.directory, benchmark.card)
            const model = benchmark.judged || benchmark.card !== undefined ? liveContext(options, language, counters) : undefined
            const report = await runChecks({ world: world.world, ...card === undefined ? {} : { card }, ...model === undefined ? {} : { model } }, { ids: benchmark.checks, deep: true })
            results.push({
              case: benchmark.id, kind: benchmark.kind, language, run, ms: Date.now() - began, scored: score(benchmark, report.findings),
              findings: report.findings.map(finding => ({ check: finding.check, code: finding.code, where: finding.where })), skipped: report.skipped, counters,
            })
          } finally { await world.remove() }
        }, 3_600_000)
      }
    }
  }
})
