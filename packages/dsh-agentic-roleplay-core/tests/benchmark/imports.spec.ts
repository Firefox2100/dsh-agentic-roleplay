import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SHAPES, shapeCards, shapeProblems, type ShapeId } from './import-cards.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { importCard } from './panels-run.ts'
import { openTrace, traceFolder } from './trace.ts'

/**
 * The import-shape benchmark, live: every invented card of `import-cards.ts` (one character, a cast, an embedded lorebook with a secret, writing instructions, greetings, almost nothing,
 * a card that gives orders to what reads it) is imported with real models, in both languages, through the product's own survey, build and finish, and the world that comes out is held to
 * what the card's shape asks (`shapeProblems`). Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=imports npx vitest run tests/benchmark/imports.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_ONLY (shapes), BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'imports')
const only = process.env['BENCH_ONLY']?.split(',') as ShapeId[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { trace?: string | undefined; shape: ShapeId; language: Language; run: number; finished: boolean; problems: string[]; notes: string[]; ms: number; counters: ReturnType<typeof newCounters> }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const summary = {
    label, options: { llm: options.llm.model, temperature: options.llm.temperature }, runs: results.length, held: results.filter(result => result.finished && result.problems.length === 0).length,
    byShape: Object.fromEntries(SHAPES.map(shape => [shape, results.filter(result => result.shape === shape).map(result => `${result.language}#${result.run}: ${result.finished ? (result.problems.length === 0 ? 'held' : result.problems.join('; ')) : 'import did not finish'}`)])),
    seconds: Math.round(results.reduce((count, result) => count + result.ms, 0) / 1000), failedJobs: results.reduce((count, result) => count + result.counters.failures.length, 0),
  }
  const file = join(out, `imports-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the import-shape benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const shape of SHAPES.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${shape}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const made = shapeCards(language).find(entry => entry.shape === shape)!
          const trace = openTrace(traceFolder(out, label), `${language}-${shape}-${run}`, { id: made.id, label, language, run, options: { llm: options.llm.model, temperature: options.llm.temperature, reasoning: options.llm.reasoning } })
          const counters = newCounters(trace)
          const began = Date.now()
          const world = await importCard(made, liveContext(options, language, counters), trace)
          const problems = shapeProblems(made.expect, world)
          trace.expect('the import finished', world.finished, {})
          trace.expect('the world holds what the card\'s shape asks', problems.length === 0, { problems })
          results.push({ trace: trace.file, shape, language, run, finished: world.finished, problems, notes: world.notes, ms: Date.now() - began, counters })
          expect(world.finished, 'the import did not finish').toBe(true)
          // a missed person or place in one run is the model's variance and shows in the summary; a leaked secret or an obeyed instruction is a failure of the product
          const firm = problems.filter(problem => problem.startsWith('the secret') || problem.startsWith('an instruction'))
          expect(firm).toEqual([])
        }, 900_000)
      }
    }
  }
})
