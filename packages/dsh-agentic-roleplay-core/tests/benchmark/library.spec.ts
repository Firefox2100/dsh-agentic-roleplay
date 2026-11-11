import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { LIBRARY, libraryCases, libraryProblems, type LibraryId } from './library-cases.ts'
import { importLibraryFile } from './library-run.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { openTrace, traceFolder } from './trace.ts'

/**
 * The library-import benchmark, live: the invented preset and lorebook files of `library-cases.ts` go through the product's own importers (the style job of a narration preset, the
 * classification of a lorebook's entries) with real models, in both languages, and what comes out is held to what the file asks (`libraryProblems`). In-process, no DSH rig. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=library npx vitest run tests/benchmark/library.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_ONLY (kinds), BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'library')
const only = process.env['BENCH_ONLY']?.split(',') as LibraryId[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { trace?: string | undefined; kind: LibraryId; language: Language; run: number; problems: string[]; notes: string[]; ms: number }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const summary = {
    label, options: { llm: options.llm.model, temperature: options.llm.temperature }, runs: results.length, held: results.filter(result => result.problems.length === 0).length,
    byKind: Object.fromEntries(LIBRARY.map(kind => [kind, results.filter(result => result.kind === kind).map(result => `${result.language}#${result.run}: ${result.problems.length === 0 ? 'held' : result.problems.join('; ')}`)])),
    seconds: Math.round(results.reduce((count, result) => count + result.ms, 0) / 1000),
  }
  const file = join(out, `library-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the library-import benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const kind of LIBRARY.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${kind}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const made = libraryCases(language).find(entry => entry.kind === kind)!
          const trace = openTrace(traceFolder(out, label), `${language}-${kind}-${run}`, { id: made.id, label, language, run, options: { llm: options.llm.model, temperature: options.llm.temperature, reasoning: options.llm.reasoning } })
          const began = Date.now()
          const outcome = await importLibraryFile(made, liveContext(options, language, newCounters(trace)))
          const problems = libraryProblems(made.expect, outcome)
          trace.state('outcome', { prompts: outcome.prompts, rules: outcome.rules, entries: outcome.entries, steering: outcome.steering, notes: outcome.notes })
          trace.expect('the import holds what the file asks', problems.length === 0, { problems })
          results.push({ trace: trace.file, kind, language, run, problems, notes: outcome.notes, ms: Date.now() - began })
          // a lost style or fact is the model's variance and shows in the summary; a leaked format or secret and an obeyed order are failures of the product
          expect(problems.filter(problem => /demanded|told to everyone|obeyed/.test(problem))).toEqual([])
        }, 600_000)
      }
    }
  }
})
