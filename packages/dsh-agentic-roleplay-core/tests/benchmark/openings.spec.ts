import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { shapeOpening } from '../../src/host/import/opening-parts.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { OPENING_KINDS, PLAYER_ID, openingCases, openingCast, openingProblems, type OpeningKind } from './opening-cases.ts'
import { openTrace, traceFolder } from './trace.ts'

/**
 * The opening-shaping benchmark, live: each invented greeting of `opening-cases.ts` goes through `shapeOpening` with real models, in both languages and in each mode the import has: the
 * language model alone (`llm`), and with the decision model asking "does anyone speak aloud?" first (`decision`). In-process, no DSH rig. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=openings npx vitest run tests/benchmark/openings.spec.ts
 *
 * Choices (environment): BENCH_MODES (llm,decision), BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_DECISION_URL, BENCH_DECISION_MODEL, BENCH_ONLY (kinds), BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 * A word changed is impossible by construction (the gate refuses it); every other miss is the model's, and is reported by kind and mode.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'openings')
const only = process.env['BENCH_ONLY']?.split(',') as OpeningKind[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const modes = env('BENCH_MODES', 'llm,decision').split(',') as ('llm' | 'decision')[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}
const decision = { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 }

interface Result { trace?: string | undefined; id: string; kind: OpeningKind; language: Language; mode: string; run: number; problems: string[]; parts: number; probability?: number | undefined; llmCalls: number; ms: number }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const group = (rows: Result[]) => ({ runs: rows.length, held: rows.filter(row => row.problems.length === 0).length, llmCalls: rows.reduce((sum, row) => sum + row.llmCalls, 0) })
  return {
    label, llm: base.llm.model, decision: decision.model,
    byMode: Object.fromEntries(modes.map(mode => [mode, Object.fromEntries([...OPENING_KINDS, 'all' as const].map(kind => [kind, group(results.filter(row => row.mode === mode && (kind === 'all' || row.kind === kind)))]))])),
    byLanguage: Object.fromEntries(LANGUAGES.map(language => [language, group(results.filter(row => row.language === language))])),
    missed: results.filter(row => row.problems.length > 0).map(row => `${row.mode} ${row.id}#${row.run}: ${row.problems.join('; ')}`),
    probabilities: results.filter(row => row.probability !== undefined).map(row => `${row.id}: ${row.probability!.toFixed(2)}`),
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `openings-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe.skipIf(!live)(`the opening-shaping benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const mode of modes) {
      for (const made of openingCases(language).filter(entry => only === undefined || only.includes(entry.kind))) {
        for (let run = 1; run <= repeat; run += 1) {
          it(`${language} ${mode} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
            const trace = openTrace(traceFolder(out, label), `${language}-${mode}-${made.id}-${run}`, { id: made.id, label, language, run, options: { mode, llm: base.llm.model, decision: mode === 'decision' ? decision.model : undefined } })
            const counters = newCounters(trace)
            const context = liveContext(mode === 'decision' ? { ...base, decision } : base, language, counters)
            let probability: number | undefined
            if (context.decide !== undefined) {
              const ask = context.decide
              context.decide = async (state, asks) => { const answer = await ask(state, asks); probability = answer.get('speech'); return answer }
            }
            const began = Date.now()
            const shaped = await shapeOpening(context, made.passage, openingCast(language), PLAYER_ID)
            const problems = openingProblems(made, shaped)
            trace.state('outcome', { passage: made.passage, shaped, probability })
            trace.expect('the greeting is shaped as a reader would', problems.length === 0, { problems })
            results.push({ trace: trace.file, id: made.id, kind: made.kind, language, mode, run, problems, parts: shaped.parts?.length ?? 0, probability, llmCalls: counters.llmCalls, ms: Date.now() - began })
          }, 300_000)
        }
      }
    }
  }
})
