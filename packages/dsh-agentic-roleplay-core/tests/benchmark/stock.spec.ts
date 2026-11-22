import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { REPEAT_RESULT, repeatedSentences } from '../../src/host/decisions/repeats.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, liveDecisionService, newCounters, type LiveOptions } from './live.ts'
import { STOCK_CASES } from './stock-cases.ts'

/**
 * The stock-phrase benchmark: gestures and atmosphere lines that come back in other words each turn. Three things are measured. The exact-sentence check of the repeat gate (it cannot see
 * these, and the result says how many). How well the closeness of an embedding separates a stale echo from a fresh action (the candidate finder a feature would need). And whether the
 * shipped repeat prompt, given the earlier clauses, calls the stale ones stale and the meant ones and fresh ones not. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=stock npx vitest run tests/benchmark/stock.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_EMBED_MODEL, BENCH_EMBED_URL, BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'stock')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  embed: { url: env('BENCH_EMBED_URL', 'http://localhost:8081/v1'), model: env('BENCH_EMBED_MODEL', 'qwen3-embedding-8b') },
  concurrency: 2,
}
const decision = { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 }
const CUTS = [0.5, 0.6, 0.7, 0.8]

interface Result { id: string; kind: string; language: Language; run: number; exact: boolean; closeness: number; llm: boolean; probability: number }
const results: Result[] = []

const cosine = (a: number[], b: number[]): number => {
  let dot = 0; let na = 0; let nb = 0
  for (let i = 0; i < a.length; i += 1) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2 }
  return dot / Math.sqrt(na * nb)
}

/** Probability that a random stale case is closer to its earlier clauses than a random fresh one. */
function auc(rows: Result[], against: 'fresh' | 'hard' = 'fresh'): number | undefined {
  const high = rows.filter(row => row.kind === 'stale'); const low = rows.filter(row => row.kind === against)
  if (high.length === 0 || low.length === 0) return undefined
  let wins = 0
  for (const a of high) for (const b of low) wins += a.closeness > b.closeness ? 1 : a.closeness === b.closeness ? 0.5 : 0
  return wins / (high.length * low.length)
}

const rate = (rows: Result[], flagged: (row: Result) => boolean) => ({
  staleFlagged: rows.filter(row => row.kind === 'stale' && flagged(row)).length, stale: rows.filter(row => row.kind === 'stale').length,
  meantFlagged: rows.filter(row => row.kind === 'meant' && flagged(row)).length, meant: rows.filter(row => row.kind === 'meant').length,
  freshFlagged: rows.filter(row => row.kind === 'fresh' && flagged(row)).length, fresh: rows.filter(row => row.kind === 'fresh').length,
  hardFlagged: rows.filter(row => row.kind === 'hard' && flagged(row)).length, hard: rows.filter(row => row.kind === 'hard').length,
})

function summarise(): Record<string, unknown> {
  const by = (language?: Language) => {
    const rows = results.filter(row => language === undefined || row.language === language)
    return { runs: rows.length, exact: rate(rows, row => row.exact), closenessAuc: auc(rows), closenessAucHard: auc(rows, 'hard'), closeness: Object.fromEntries(CUTS.map(cut => [cut, rate(rows, row => row.closeness >= cut)])), llm: rate(rows, row => row.llm), decision: Object.fromEntries([0.4, 0.5, 0.7].map(cut => [cut, rate(rows, row => row.probability >= cut)])) }
  }
  return { label, llm: base.llm.model, embed: base.embed?.model, decision, all: by(), ...Object.fromEntries(LANGUAGES.map(language => [language, by(language)])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `stock-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the stock-phrase benchmark cases', () => {
  it('are labelled in all three ways, in both languages, and are never the same words as an earlier clause', () => {
    expect(new Set(STOCK_CASES.map(made => made.id)).size).toBe(STOCK_CASES.length)
    for (const kind of ['stale', 'meant', 'fresh', 'hard']) expect(STOCK_CASES.filter(made => made.kind === kind).length, kind).toBeGreaterThanOrEqual(3)
    for (const made of STOCK_CASES) {
      for (const language of LANGUAGES) {
        expect(made.earlier[language].length, `${made.id} ${language}`).toBe(3)
        expect(repeatedSentences(made.clause[language], made.earlier[language], DEFAULT_SETTINGS.decisions.repeatChars), `${made.id} ${language}`).toEqual([])
      }
    }
  })
})

describe.skipIf(!live)(`the stock-phrase benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of STOCK_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const counters = newCounters()
          const context = liveContext(base, language, counters)
          const clause = made.clause[language]
          const earlier = made.earlier[language]
          const vectors = (await context.embed!([clause, ...earlier])).vectors
          const closeness = Math.max(...earlier.map((_, index) => cosine(vectors[0]!, vectors[index + 1]!)))
          const persona = `${shippedText('roleplay/gate-repeat', language, { sentence: 'each numbered sentence' })}\n\nGive your reason in one short sentence first, then the numbers of the sentences that are stale filler.`
          const told = `The sentences are not the same words, but may say the same thing again. Earlier turns told:\n${earlier.map(line => `- ${line}`).join('\n')}`
          const prompt = `The narration:\n${clause}\n\nThe sentences to check:\n1. ${clause}\n   ${told}`
          const answer = await context.run({ persona, prompt, result: REPEAT_RESULT } as never) as { stale: number[] }
          const asked = await liveDecisionService(decision, counters).decide(
            { narration: clause, earlier_turns: earlier.join('\n') },
            { repeat0: { type: 'noul', instructions: shippedText('roleplay/gate-repeat', language, { sentence: clause }) } },
          )
          results.push({ id: made.id, kind: made.kind, language, run, exact: repeatedSentences(clause, earlier, DEFAULT_SETTINGS.decisions.repeatChars).length > 0, closeness, llm: answer.stale.includes(1), probability: asked.answers['repeat0']!.probability })
        }, 300_000)
      }
    }
  }
})
