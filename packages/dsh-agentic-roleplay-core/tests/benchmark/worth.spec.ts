import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { WORTH_RESULT } from '../../src/host/images/worth.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { WORTH_CASES, worthText } from './worth-cases.ts'

/**
 * The "when it matters" picture mode, live: each moment is put to the language model with the shipped `roleplay/image-worth` prompt and the result schema the product uses
 * (one request with a required `submit_result` call), and its yes or no is held to the label. A moment that deserves a picture and gets none is a miss, one that does not and gets
 * one is a false alarm, which costs an image generation. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=worth npx vitest run tests/benchmark/worth.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'worth')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { id: string; language: Language; run: number; worth: boolean; said: boolean; reason: string; ms: number }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const count = (rows: Result[]) => {
    const tp = rows.filter(row => row.worth && row.said).length
    const fn = rows.filter(row => row.worth && !row.said).length
    const fp = rows.filter(row => !row.worth && row.said).length
    return { runs: rows.length, right: rows.filter(row => row.worth === row.said).length, missed: fn, falseAlarms: fp, precision: tp + fp === 0 ? undefined : tp / (tp + fp), recall: tp + fn === 0 ? undefined : tp / (tp + fn) }
  }
  return {
    label, llm: base.llm.model, all: count(results),
    byLanguage: Object.fromEntries(LANGUAGES.map(language => [language, count(results.filter(row => row.language === language))])),
    wrong: results.filter(row => row.worth !== row.said).map(row => `${row.language} ${row.id}#${row.run}: said ${row.said}, labelled ${row.worth} (${row.reason})`),
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `worth-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the worth-a-picture cases', () => {
  it('are labelled both ways, in both languages, with a distinct id each', () => {
    expect(new Set(WORTH_CASES.map(made => made.id)).size).toBe(WORTH_CASES.length)
    expect(WORTH_CASES.filter(made => made.worth).length).toBeGreaterThanOrEqual(6)
    expect(WORTH_CASES.filter(made => !made.worth).length).toBeGreaterThanOrEqual(6)
    for (const made of WORTH_CASES) for (const language of LANGUAGES) expect(worthText(made, language).length).toBeGreaterThan(25)
  })
})

describe.skipIf(!live)(`the worth-a-picture benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of WORTH_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const counters = newCounters()
          const context = liveContext(base, language, counters)
          const began = Date.now()
          const answer = await context.run({ persona: context.text('roleplay/image-worth'), prompt: worthText(made, language), result: WORTH_RESULT } as never) as { reason: string; worth: boolean }
          results.push({ id: made.id, language, run, worth: made.worth, said: answer.worth, reason: answer.reason, ms: Date.now() - began })
          expect(typeof answer.worth, 'the child answers whether the moment is worth a picture').toBe('boolean')
          expect(answer.reason.trim().length, 'the child says in words why it judged the moment so').toBeGreaterThan(0)
        }, 300_000)
      }
    }
  }
})
