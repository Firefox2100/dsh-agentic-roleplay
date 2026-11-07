import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { askExtra } from '../../src/host/decisions/extras.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { LANGUAGES, type Language } from './language.ts'
import { liveDecisionService, newCounters } from './live.ts'
import { REUSE_CASES } from './reuse-cases.ts'

/**
 * The picture-reuse benchmark: for each moment, the stored pictures close to it are put to the decision model the way `pictureReuse` does (one yes-or-no for each, the shipped
 * `roleplay/decide-reuse` question, the cut `decisions.gateThreshold`), and scored on which it accepts. The product takes the first accepted picture, so a wrong first pick is
 * counted apart from a miss. Needs the decision model, so it runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=reuse-kev9b npx vitest run tests/benchmark/reuse.spec.ts
 *
 * Choices (environment): BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_THRESHOLD, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'reuse')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const threshold = Number(env('BENCH_THRESHOLD', String(DEFAULT_SETTINGS.decisions.gateThreshold)))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const decision = { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 }

interface Result {
  case: string
  language: Language
  run: number
  tp: number
  fn: number
  fp: number
  /** The first accepted picture does not show the moment. */
  wrongFirst: boolean
  /** The first accepted picture shows it, or nothing is accepted and nothing fits. */
  rightFirst: boolean
  found: string[]
  ms: number
}

const results: Result[] = []
const signal = new AbortController().signal

function summarise(): Record<string, unknown> {
  const sum = (pick: (result: Result) => number): number => results.reduce((count, result) => count + pick(result), 0)
  const tp = sum(result => result.tp)
  const fp = sum(result => result.fp)
  const fn = sum(result => result.fn)
  return {
    label, decision, threshold, moments: results.length, tp, fp, fn, precision: tp + fp === 0 ? undefined : tp / (tp + fp), recall: tp + fn === 0 ? undefined : tp / (tp + fn),
    rightFirst: sum(result => (result.rightFirst ? 1 : 0)), wrongFirst: sum(result => (result.wrongFirst ? 1 : 0)), seconds: Math.round(sum(result => result.ms) / 1000),
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `reuse-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the reuse benchmark cases', () => {
  it('give every moment at least two stored pictures, in both languages, and at most one that fits', () => {
    expect(new Set(REUSE_CASES.map(benchmark => benchmark.id)).size).toBe(REUSE_CASES.length)
    for (const benchmark of REUSE_CASES) {
      expect(benchmark.candidates.length, benchmark.id).toBeGreaterThanOrEqual(2)
      expect(benchmark.candidates.filter(candidate => candidate.fits).length, benchmark.id).toBeLessThanOrEqual(1)
      for (const language of LANGUAGES) {
        expect(benchmark.moment[language].length).toBeGreaterThan(10)
        for (const candidate of benchmark.candidates) expect(candidate.description[language].length).toBeGreaterThan(10)
      }
    }
    expect(REUSE_CASES.some(benchmark => benchmark.candidates.every(candidate => !candidate.fits))).toBe(true)
  })
})

describe.skipIf(!live)(`the reuse benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const benchmark of REUSE_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${benchmark.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const counters = newCounters()
          const began = Date.now()
          const asks = benchmark.candidates.map((candidate, index) => ({ key: `picture${index}`, instructions: shippedText('roleplay/decide-reuse', language, { description: candidate.description[language].trim() }) }))
          const { found, report } = await askExtra(liveDecisionService(decision, counters) as never, { moment: benchmark.moment[language] }, asks, threshold, signal)
          expect(report.problem).toBeUndefined()
          const accepted = new Set(found)
          const indexes = benchmark.candidates.map((candidate, index) => ({ candidate, key: `picture${index}` }))
          const first = indexes.find(entry => accepted.has(entry.key))
          results.push({
            case: benchmark.id, language, run, ms: Date.now() - began, found,
            tp: indexes.filter(entry => entry.candidate.fits && accepted.has(entry.key)).length,
            fn: indexes.filter(entry => entry.candidate.fits && !accepted.has(entry.key)).length,
            fp: indexes.filter(entry => !entry.candidate.fits && accepted.has(entry.key)).length,
            wrongFirst: first !== undefined && !first.candidate.fits,
            rightFirst: first === undefined ? indexes.every(entry => !entry.candidate.fits) : first.candidate.fits,
          })
        }, 300_000)
      }
    }
  }
})
