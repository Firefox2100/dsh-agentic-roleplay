import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { DIRECTIVE, importCard } from './panels-run.ts'
import { openTrace, traceFolder } from './trace.ts'
import { PANEL_STYLES, leaks, panelCards, type PanelStyle } from './panel-cards.ts'

/**
 * The status-panel benchmark, live: every invented card of `panel-cards.ts` is imported with real models, in both languages, through the product's own survey, build and finish, and the
 * world that comes out is read for what must not be in it: a status bar, a block of tags, a fill-in placeholder or an update call (`leaks`), or a sentence that tells the game master to
 * print one, in the opening, the alternate openings, the prompts, the background and the characters. It also needs the values the card shows to have become tracked variables. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=panels npx vitest run tests/benchmark/panels.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_ONLY (styles: fence,html,tags,state), BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'panels')
const only = process.env['BENCH_ONLY']?.split(',') as PanelStyle[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { trace?: string | undefined; card: string; style: PanelStyle; language: Language; run: number; leaks: string[]; directives: string[]; variables: number; expected: number; notes: string[]; ms: number; counters: ReturnType<typeof newCounters> }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const clean = results.filter(result => result.leaks.length === 0 && result.directives.length === 0)
  const summary = {
    label, options: { llm: options.llm.model, temperature: options.llm.temperature }, runs: results.length, clean: clean.length,
    leaked: results.filter(result => result.leaks.length > 0).map(result => `${result.language} ${result.style} #${result.run}: ${result.leaks.join(', ')}`),
    directives: results.filter(result => result.directives.length > 0).map(result => `${result.language} ${result.style} #${result.run}: ${result.directives.join(', ')}`),
    variablesFound: results.reduce((count, result) => count + Math.min(result.variables, result.expected), 0), variablesExpected: results.reduce((count, result) => count + result.expected, 0),
    seconds: Math.round(results.reduce((count, result) => count + result.ms, 0) / 1000), failedJobs: results.reduce((count, result) => count + result.counters.failures.length, 0),
  }
  const file = join(out, `panels-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the status-panel benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const style of PANEL_STYLES.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${style}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const made = panelCards(language).find(entry => entry.style === style)!
          const trace = openTrace(traceFolder(out, label), `${language}-${style}-${run}`, { id: made.id, label, language, run, options: { llm: options.llm.model, temperature: options.llm.temperature, reasoning: options.llm.reasoning } })
          const counters = newCounters(trace)
          const began = Date.now()
          const world = await importCard(made, liveContext(options, language, counters), trace)
          const leaked = world.texts.filter(entry => leaks(entry.text.replace(/\$\{[^}]*\}/g, ''))).map(entry => entry.where)
          const directives = world.texts.filter(entry => DIRECTIVE[language].test(entry.text)).map(entry => entry.where)
          trace.expect('no panel, tag block, placeholder or update call in the world', leaked.length === 0, { in: leaked })
          trace.expect('nothing tells the game master to print a panel', directives.length === 0, { in: directives })
          trace.expect('the world check finds no panel', world.checkFindings.length === 0, { found: world.checkFindings })
          trace.expect('the values the card shows became variables', world.variables >= 1, { variables: world.variables, expected: made.values })
          results.push({ trace: trace.file, card: made.id, style, language, run, leaks: leaked, directives, variables: world.variables, expected: made.values, notes: world.notes, ms: Date.now() - began, counters })
          expect(leaked, 'a panel, tag block, placeholder or update call is in the world').toEqual([])
          expect(directives, 'something in the world tells the game master to print a panel').toEqual([])
          expect(world.checkFindings, 'the world check finds a panel').toEqual([])
          // one value missed in a run is the model's variance and shows in the summary; none at all is a regression
          expect(world.variables, 'the values the card shows became variables').toBeGreaterThanOrEqual(1)
        }, 900_000)
      }
    }
  }
})
