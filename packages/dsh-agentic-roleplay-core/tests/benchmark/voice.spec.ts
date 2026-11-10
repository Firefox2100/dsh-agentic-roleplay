import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveDecisionService, newCounters } from './live.ts'
import { VOICE_CASES } from './voice-cases.ts'
import { VOICE_CUT, judgeVoice, sheetsOf, voiceAsk, type VoiceJudge } from './voice.ts'

/**
 * The voice judge benchmark: each line of each invented character is put to the decision model the way a `speaks-in-voice` expectation does it, one yes-or-no for the line against the
 * character's speech style and examples, and scored against the label. It decides whether the expectation can be trusted, so it runs before the expectation is used on a new model:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=voice-kev9b npx vitest run tests/benchmark/voice.spec.ts
 *
 * Choices (environment): BENCH_DECISION_MODEL, BENCH_DECISION_URL, BENCH_THRESHOLD, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'voice')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const cut = Number(env('BENCH_THRESHOLD', String(VOICE_CUT)))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const decision = { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 }

interface Result { id: string; language: Language; run: number; fits: boolean; probability: number }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const counts = (language?: Language) => {
    const own = results.filter(result => language === undefined || result.language === language)
    const tp = own.filter(result => result.fits && result.probability >= cut).length
    const fn = own.filter(result => result.fits && result.probability < cut).length
    const fp = own.filter(result => !result.fits && result.probability >= cut).length
    const tn = own.filter(result => !result.fits && result.probability < cut).length
    return { lines: own.length, tp, fn, fp, tn, accuracy: own.length === 0 ? undefined : (tp + tn) / own.length }
  }
  return { label, decision, cut, ...counts(), ...Object.fromEntries(LANGUAGES.map(language => [language, counts(language)])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `voice-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the voice benchmark cases', () => {
  it('give every character a style and examples, and lines that fit and lines that do not, in both languages', () => {
    expect(new Set(VOICE_CASES.map(benchmark => benchmark.id)).size).toBe(VOICE_CASES.length)
    for (const benchmark of VOICE_CASES) {
      expect(benchmark.lines.some(entry => entry.fits), benchmark.id).toBe(true)
      expect(benchmark.lines.some(entry => !entry.fits), benchmark.id).toBe(true)
      for (const language of LANGUAGES) {
        expect(benchmark.sheet[language].style.length).toBeGreaterThan(10)
        expect(benchmark.sheet[language].examples.length).toBeGreaterThan(0)
        for (const entry of benchmark.lines) expect(entry.text[language].length).toBeGreaterThan(5)
      }
    }
  })
})

describe('the voice judge', () => {
  const answering = (probability: (state: Record<string, unknown>) => number): VoiceJudge => ({
    decide: async (state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul' as const, probability: probability(state) }])) }),
  })

  it('asks about the line with the character\'s style and examples as the state, in the question\'s language', () => {
    const sheet = VOICE_CASES[0]!.sheet.zh
    const ask = voiceAsk(sheet, '四号泊位。', 'zh')
    expect(ask.state).toEqual({ character: sheet.name, speech_style: sheet.style, examples: sheet.examples, line: '四号泊位。' })
    expect(ask.instructions).toContain('说话')
  })

  it('counts a line as in voice from the cut', async () => {
    const sheet = VOICE_CASES[0]!.sheet.en
    expect(await judgeVoice(answering(() => 0.7), sheet, ['a', 'b'], 'en')).toEqual({ lines: 2, fits: 2 })
    expect(await judgeVoice(answering(() => 0.2), sheet, ['a', 'b'], 'en')).toEqual({ lines: 2, fits: 0 })
    expect(await judgeVoice(answering(state => (state['line'] === 'a' ? 0.9 : 0.1)), sheet, ['a', 'b'], 'en')).toEqual({ lines: 2, fits: 1 })
  })

  it('reads the speech sheets out of a composed world and skips a character that has no style', () => {
    const files = new Map<string, unknown>([
      ['characters/orrin/character.json', { name: 'Orrin', speech: { style: 'Terse.', examples: ['Papers.', 5] } }],
      ['characters/mute/character.json', { name: 'Mute', speech: { style: '  ' } }],
      ['characters/none/character.json', { name: 'None' }],
      ['world.json', { name: 'W' }],
    ])
    expect([...sheetsOf(files)]).toEqual([['orrin', { name: 'Orrin', style: 'Terse.', examples: ['Papers.'] }]])
  })
})

describe.skipIf(!live)('the decision model on the voice cases', () => {
  const service = liveDecisionService(decision, newCounters())
  for (const language of languages) {
    for (let run = 1; run <= repeat; run += 1) {
      it(`${language}${repeat > 1 ? ` #${run}` : ''}`, async () => {
        for (const benchmark of VOICE_CASES) {
          for (const entry of benchmark.lines) {
            const ask = voiceAsk(benchmark.sheet[language], entry.text[language], language)
            const { answers } = await service.decide(ask.state, { voice: { type: 'noul', instructions: ask.instructions } })
            results.push({ id: benchmark.id, language, run, fits: entry.fits, probability: answers['voice']!.probability })
          }
        }
        expect(results.length).toBeGreaterThan(0)
      }, 0)
    }
  }
})
