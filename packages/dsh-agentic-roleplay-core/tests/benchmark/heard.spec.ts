import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { HEARD_CASES, STANCE_QUESTION, STANCE_SCHEMA, heardRequest, type Stance } from './heard.ts'
import { Trace } from './trace.ts'

/**
 * The heard-claims benchmark: a character asked about something it heard, told how it stands by what it saw itself, answers by that standing (stands by it, rejects it, or says it cannot tell). The
 * character's request is the product's own persona and brief; a second request reads the stance from what it said and meant. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=heard npx vitest run tests/benchmark/heard.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_REASONING, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT, BENCH_TRACE=0.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'heard')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '3'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = { llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: 0.8, reasoning: env('BENCH_REASONING', 'none') }, concurrency: 2 }

interface Result { id: string; language: Language; run: number; expected: Stance; found?: Stance; said?: string; failed?: string }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const held = (rows: Result[]) => ({ runs: rows.length, held: rows.filter(row => row.found === row.expected).length, failed: rows.filter(row => row.failed !== undefined).length })
  const summary = { label, llm: base.llm.model, all: held(results), ...Object.fromEntries(LANGUAGES.map(language => [language, held(results.filter(row => row.language === language))])), ...Object.fromEntries(HEARD_CASES.map(made => [made.id, held(results.filter(row => row.id === made.id))])) }
  const file = join(out, `heard-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe('the heard-claims cases', () => {
  it('tell the asked character the claim with its own standing in both languages, and ask a different thing of each stance', () => {
    expect(new Set(HEARD_CASES.map(made => made.stance))).toEqual(new Set(['affirms', 'rejects', 'unsure']))
    for (const made of HEARD_CASES) for (const language of LANGUAGES) {
      const { prompt, persona } = heardRequest(made, language)
      const said = made.text(language)
      expect(prompt, `${made.id} ${language}`).toContain(said.claim)
      expect(prompt).toContain(said.situation)
      expect(persona.length).toBeGreaterThan(100)
    }
    const standings = HEARD_CASES.map(made => heardRequest(made, 'en').prompt)
    expect(standings[0]).toContain('what you saw says it is so')
    expect(standings[1]).toContain('what you saw says it is not so')
    expect(standings[2]).toContain('you saw nothing that bears on it, so you cannot say whether it is so')
  })
})

describe.skipIf(!live)(`the heard-claims benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of HEARD_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id} #${run}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const context = liveContext(base, language, newCounters(trace))
          const { persona, prompt, schema } = heardRequest(made, language)
          const row: Result = { id: made.id, language, run, expected: made.stance }
          try {
            const answer = await context.run({ persona, prompt, result: schema, maxTokens: 900 } as never) as { intent: string; utterance?: string }
            row.said = `${answer.utterance ?? ''} (${answer.intent})`
            const judged = await context.run({ persona: STANCE_QUESTION[language], prompt: `${made.text(language).claim}\n\n${row.said}`, result: STANCE_SCHEMA, maxTokens: 200 } as never) as { stance: Stance }
            row.found = judged.stance
            trace.event('expect', { expected: made.stance, found: judged.stance, held: judged.stance === made.stance })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
