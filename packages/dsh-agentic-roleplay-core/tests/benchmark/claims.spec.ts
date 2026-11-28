import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { InvalidEditError, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { castName } from './attribution-cases.ts'
import { CLAIMS_CASES } from './claims-cases.ts'
import { keeperEstimate } from '../../src/host/orchestration/committer.ts'
import { jobOf, scoreEdit, type Problem } from './claims.ts'

/**
 * The claims benchmark: a theory or accusation must be recorded as a proposed claim by the one who makes it, a plain fact must not become one, and evidence must bear on a claim with the right sign and never as
 * proof when it is only talk; rival theories are related, compatible ones are not; a hidden act is recorded as kept from the one it is hidden from. Each case gives the language model the keeper's real persona,
 * brief and records schema, as one request that answers with the records edit (the product's keeper can also read its work back, which this does not). Scored from the structured edit by ids and bearings.
 * Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=claims npx vitest run tests/benchmark/claims.spec.ts
 *
 * Choices (environment): BENCH_LLM_MODEL, BENCH_LLM_URL, BENCH_LANGS, BENCH_REPEAT, BENCH_OUT, BENCH_TRACE=0 to write no traces.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'claims')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const only = process.env['BENCH_CASES']?.split(',')
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { id: string; kind: string; language: Language; run: number; problems: Problem[]; /** Why the product would have refused the first draft, which its keeper would then correct. */ refused?: string[]; failed?: string }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, clean: rows.filter(row => row.problems.length === 0 && row.failed === undefined).length, refused: rows.filter(row => row.refused !== undefined).length, failed: rows.filter(row => row.failed !== undefined).length })
  const rules = (rows: Result[]) => rows.flatMap(row => row.problems.map(problem => problem.rule)).reduce<Record<string, number>>((count, rule) => ({ ...count, [rule]: (count[rule] ?? 0) + 1 }), {})
  return {
    label, llm: base.llm.model, all: by(results), problems: rules(results),
    ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])),
    ...Object.fromEntries([...new Set(results.map(row => row.kind))].map(kind => [kind, by(results.filter(row => row.kind === kind))])),
  }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `claims-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the claims benchmark cases', () => {
  it('cover every kind, have unique ids, and build the keeper brief in both languages with the events the claims link to', () => {
    expect(new Set(CLAIMS_CASES.map(made => made.id)).size).toBe(CLAIMS_CASES.length)
    expect(new Set(CLAIMS_CASES.map(made => made.kind))).toEqual(new Set(['theory', 'plain', 'against', 'for', 'talk', 'replaced', 'rivals', 'compatible', 'hidden']))
    for (const made of CLAIMS_CASES) {
      for (const language of LANGUAGES) {
        const { prompt, persona, roundEvents, priorClaims, session } = jobOf(made, language)
        expect(persona, `${made.id} ${language}`).toContain('claim_links')
        expect(prompt, `${made.id} ${language}`).toContain(made.situation(language))
        for (const who of made.present) expect(prompt, `${made.id} ${language} ${who}`).toContain(castName(who, language))
        for (const id of roundEvents) expect(prompt, `${made.id} ${language}: event ${id}`).toContain(`id ${id},`)
        expect(priorClaims.length).toBe(made.prior(language).claims.length)
        for (const id of priorClaims) expect(prompt, `${made.id} ${language}: claim ${id}`).toContain(`- id ${id}, `)
        session.close()
      }
    }
  })

  it('judges a draft by ids and bearings: a plain fact made a claim, evidence with the wrong sign, talk taken as proof, rivals missed, a hiding missed', () => {
    const find = (id: string) => CLAIMS_CASES.find(candidate => candidate.id === id)!
    const score = (id: string, answer: object, language: Language = 'en') => { const { roundEvents, priorClaims, session } = jobOf(find(id), language); const found = scoreEdit({ turn: 3, ...answer }, find(id), roundEvents, priorClaims); session.close(); return found.map(problem => problem.rule) }
    expect(score('plain-fact', { claims: [{ text: 'The cellar is empty.' }] })).toEqual(['over-claimed'])
    expect(score('plain-fact', {})).toEqual([])
    expect(score('theory', { claims: [{ text: 'Pavel took it.', by_character: 'odile' }] })).toEqual([])
    expect(score('theory', {})).toEqual(['missing-claim'])
    expect(score('theory', { claims: [{ text: 'Pavel took it.', by_character: 'odile', status: 'confirmed' }] })).toEqual(['status-set'])
    const against = jobOf(find('evidence-against'), 'en')
    const first = against.roundEvents[0]!
    expect(scoreEdit({ turn: 3, claim_links: [{ claim: against.priorClaims[0], event: first, as: 'contradicts' }] }, find('evidence-against'), against.roundEvents, against.priorClaims)).toEqual([])
    expect(scoreEdit({ turn: 3, claim_links: [{ claim: against.priorClaims[0], event: first, as: 'confirms' }] }, find('evidence-against'), against.roundEvents, against.priorClaims).map(problem => problem.rule)).toEqual(['wrong-sign'])
    expect(scoreEdit({ turn: 3 }, find('evidence-against'), against.roundEvents, against.priorClaims).map(problem => problem.rule)).toEqual(['missing-link'])
    against.session.close()
    const talk = jobOf(find('talk-only'), 'en')
    expect(scoreEdit({ turn: 3, claim_links: [{ claim: talk.priorClaims[0], event: talk.roundEvents[0], as: 'contradicts' }] }, find('talk-only'), talk.roundEvents, talk.priorClaims).map(problem => problem.rule)).toEqual(['decisive-from-talk'])
    expect(scoreEdit({ turn: 3, claim_links: [{ claim: talk.priorClaims[0], event: talk.roundEvents[0], as: 'undermines' }] }, find('talk-only'), talk.roundEvents, talk.priorClaims)).toEqual([])
    talk.session.close()
    const rivals = [{ text: 'Accident.', by_character: 'odile' }, { text: 'On purpose.', by_character: 'pavel' }]
    expect(score('rivals', { claims: rivals, claim_questions: [{ text: 'How did it start?', rivals_new: [0, 1] }] })).toEqual([])
    expect(score('rivals', { claims: rivals })).toEqual(['missing-question'])
    expect(score('compatible', { claims: rivals, claim_questions: [{ text: 'q', rivals_new: [0, 1] }] })).toEqual(['false-question'])
    expect(score('hidden', { concealments: [{ event: 1, from: 'elias' }] })).toEqual([])
    expect(score('hidden', {})).toEqual(['missing-concealment'])
  })
})

describe.skipIf(!live)(`the claims benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of CLAIMS_CASES.filter(candidate => only === undefined || only.includes(candidate.id))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const counters = newCounters(trace)
          const { persona, prompt, schema, roundEvents, priorClaims, session } = jobOf(made, language)
          trace.state('setup', { case: made.id, language, kind: made.kind, roundEvents, priorClaims })
          const row: Result = { id: made.id, kind: made.kind, language, run, problems: [] }
          try {
            const answer = await liveContext(base, language, counters).run({ persona, prompt, result: schema, maxTokens: keeperEstimate(1, language) * 2 } as never)
            row.problems = scoreEdit(answer, made, roundEvents, priorClaims)
            try { session.edit(parseRecordsEdit(answer)) } catch (error) { if (error instanceof InvalidEditError) row.refused = [...error.problems]; else throw error }
            trace.event('expect', { problems: row.problems, refused: row.refused, held: row.problems.length === 0 })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          session.close()
          results.push(row)
        }, 600_000)
      }
    }
  }
})
