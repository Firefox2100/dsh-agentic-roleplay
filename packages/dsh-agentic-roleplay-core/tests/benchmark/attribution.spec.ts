import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { ATTRIBUTION_CASES, castName } from './attribution-cases.ts'
import { jobOf, scoreEdit, type Problem } from './attribution.ts'

/**
 * The attribution benchmark: a fact that is quoted, reported, claimed or gossiped about must be recorded for the people in the conversation, never for the person it is about, who was not
 * there,. Each case is given to the language model as the record keeper's real persona and brief, as one request that answers with
 * the records edit (the product's keeper also has tools to read its work back, which this does not; a failure here is the model's first draft, to be confirmed on the rig). Scored from the
 * structured edit by who is named. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=attribution npx vitest run tests/benchmark/attribution.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT, BENCH_TRACE=0 to write no traces.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'attribution')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { id: string; kind: string; language: Language; run: number; problems: Problem[]; failed?: string }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, clean: rows.filter(row => row.problems.length === 0 && row.failed === undefined).length, failed: rows.filter(row => row.failed !== undefined).length, byRule: Object.fromEntries(['untouched', 'speaker-missing', 'unreadable'].map(rule => [rule, rows.filter(row => row.problems.some(problem => problem.rule === rule)).length])) })
  return { label, llm: base.llm.model, all: by(results), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries([...new Set(ATTRIBUTION_CASES.map(made => made.kind))].map(kind => [kind, by(results.filter(row => row.kind === kind))])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `attribution-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the attribution benchmark cases', () => {
  it('cover every kind, name only people of the cast, and build the keeper brief in both languages', () => {
    expect(new Set(ATTRIBUTION_CASES.map(made => made.id)).size).toBe(ATTRIBUTION_CASES.length)
    expect(new Set(ATTRIBUTION_CASES.map(made => made.kind))).toEqual(new Set(['quoted', 'reported', 'gossip', 'lie', 'retold']))
    for (const made of ATTRIBUTION_CASES) {
      expect(made.untouched.length, made.id).toBeGreaterThan(0)
      expect(made.untouched.filter(who => made.present.includes(who)), `${made.id}: an absent person is not present`).toEqual([])
      for (const language of LANGUAGES) {
        const { prompt, persona } = jobOf(made, language)
        expect(persona, `${made.id} ${language}`).toContain(language === 'en' ? 'English' : 'Chinese')
        expect(prompt, `${made.id} ${language}`).toContain(made.situation(language))
        for (const who of made.present) expect(prompt, `${made.id} ${language} ${who}`).toContain(castName(who, language))
      }
    }
  })

  it('judges a draft by who is named: the person who was not there, a missing speaker', () => {
    const made = ATTRIBUTION_CASES.find(candidate => candidate.id === 'quoted-claim')!
    const event = (perceived: string[], involves: string[]) => ({ turn: 3, round: 1, text: 'Odile repeated what Elias said about the cellar key.', importance: 3, tags: ['cellar'], involves, perceived_by: perceived.map(character => ({ character, mode: 'heard' })) })
    expect(scoreEdit({ turn: 3, events: [event(['odile', 'mara'], ['odile', 'elias'])] }, made)).toEqual([])
    expect(scoreEdit({ turn: 3, events: [event(['odile', 'mara', 'elias'], ['odile'])] }, made)).toEqual([{ rule: 'untouched', detail: 'elias perceives "Odile repeated what Elias said about the cellar key."' }])
    expect(scoreEdit({ turn: 3, events: [event(['odile', 'mara'], ['mara'])] }, made).map(problem => problem.rule)).toEqual(['speaker-missing'])
    expect(scoreEdit({ turn: 3, states: [{ character: 'pavel', activity: 'asleep' }], events: [event(['odile'], ['odile'])] }, made).map(problem => problem.rule)).toEqual(['untouched'])
  })
})

describe.skipIf(!live)(`the attribution benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of ATTRIBUTION_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const counters = newCounters(trace)
          const { persona, prompt, schema } = jobOf(made, language)
          trace.state('setup', { case: made.id, language, kind: made.kind, untouched: made.untouched, speaker: made.speaker })
          const row: Result = { id: made.id, kind: made.kind, language, run, problems: [] }
          try {
            const answer = await liveContext(base, language, counters).run({ persona, prompt, result: schema } as never)
            row.problems = scoreEdit(answer, made)
            trace.event('expect', { problems: row.problems, held: row.problems.length === 0 })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
