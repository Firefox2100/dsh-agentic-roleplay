import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { REPEAT_RESULT, repeatedSentences } from '../../src/host/decisions/repeats.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, liveDecisionService, newCounters, type LiveOptions } from './live.ts'
import { REPEAT_CASES } from './repeat-cases.ts'

/**
 * The repeat gate benchmark: code finds the sentence an earlier turn told again; the question is whether it is stale filler or meant. Each case is put to the language model (the shipped
 * `roleplay/gate-repeat` prompt, the product's result schema) and to the decision model (the same prompt as the question, the cut `decisions.gateThreshold`), and held to the label.
 * `strict`, which sends back every repeat, is the baseline: it refuses every meant repeat. The probabilities are kept, so a cut can be chosen from the results. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=repeat npx vitest run tests/benchmark/repeat.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'repeat')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}
const decision = { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 }
const CUTS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

interface Result { id: string; language: Language; run: number; stale: boolean; llm: boolean; probability: number }
const results: Result[] = []

function score(rows: Result[], says: (row: Result) => boolean) {
  const tp = rows.filter(row => row.stale && says(row)).length
  const fn = rows.filter(row => row.stale && !says(row)).length
  const fp = rows.filter(row => !row.stale && says(row)).length
  return { missedStale: fn, refusedMeant: fp, precision: tp + fp === 0 ? undefined : tp / (tp + fp), recall: tp + fn === 0 ? undefined : tp / (tp + fn) }
}

function summarise(): Record<string, unknown> {
  const by = (language?: Language) => {
    const rows = results.filter(row => language === undefined || row.language === language)
    return {
      runs: rows.length, strict: score(rows, () => true), llm: score(rows, row => row.llm),
      decision: Object.fromEntries(CUTS.map(cut => [cut, score(rows, row => row.probability >= cut)])),
    }
  }
  return { label, llm: base.llm.model, decision, all: by(), ...Object.fromEntries(LANGUAGES.map(language => [language, by(language)])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `repeat-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the repeat benchmark cases', () => {
  it('are labelled both ways, and code finds the sentence in each, in both languages', () => {
    expect(new Set(REPEAT_CASES.map(made => made.id)).size).toBe(REPEAT_CASES.length)
    expect(REPEAT_CASES.filter(made => made.stale).length).toBeGreaterThanOrEqual(6)
    expect(REPEAT_CASES.filter(made => !made.stale).length).toBeGreaterThanOrEqual(6)
    for (const made of REPEAT_CASES) {
      for (const language of LANGUAGES) {
        expect(repeatedSentences(made.narration[language], [made.earlier[language]], DEFAULT_SETTINGS.decisions.repeatChars), `${made.id} ${language}`).toEqual([made.sentence[language]])
      }
    }
  })
})

describe.skipIf(!live)(`the repeat benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of REPEAT_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const counters = newCounters()
          const context = liveContext(base, language, counters)
          const sentence = made.sentence[language]
          const persona = `${shippedText('roleplay/gate-repeat', language, { sentence: 'each numbered sentence' })}\n\nGive your reason in one short sentence first, then the numbers of the sentences that are stale filler.`
          const prompt = `The narration:\n${made.narration[language]}\n\nThe sentences told in an earlier turn:\n1. ${sentence}\n   Earlier: ${made.earlier[language]}`
          const answer = await context.run({ persona, prompt, result: REPEAT_RESULT } as never) as { stale: number[] }
          const asked = await liveDecisionService(decision, counters).decide(
            { narration: made.narration[language], earlier_turns: made.earlier[language] },
            { repeat0: { type: 'noul', instructions: shippedText('roleplay/gate-repeat', language, { sentence }) } },
          )
          results.push({ id: made.id, language, run, stale: made.stale, llm: answer.stale.includes(1), probability: asked.answers['repeat0']!.probability })
        }, 300_000)
      }
    }
  }
})
