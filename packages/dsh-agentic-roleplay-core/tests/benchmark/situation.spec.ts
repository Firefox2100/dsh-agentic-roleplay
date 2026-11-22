import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, liveDecisionService, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { ACTIVATION_SCHEMA, GATE_MESSAGE, build, refusal, score, type Problem } from './situation.ts'
import { castName } from './attribution-cases.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { SITUATION_CASES } from './situation-cases.ts'

/**
 * The situation benchmark: what the game master tells the characters about a player's move that mixes speech and action with thoughts. The game master's real instructions and scene are given as one
 * request that answers with the arguments of activate_characters (no tool loop; confirm on the rig). A situation fails by carrying the person the recipient cannot know, or what only the thought holds;
 * `dropped` is a situation that lost what was said aloud, `asked-away` one that asks a character who is elsewhere. Variants: BENCH_VARIANT=old leaves out the sentence the prompt gained; `retry`
 * is what the engine's check sends back once (the second answer is the one scored). Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=situation1 BENCH_REPEAT=4 npx vitest run tests/benchmark/situation.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'situation')
const variant = env('BENCH_VARIANT', 'new') as 'old' | 'new'
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const gateMode = env('BENCH_GATE', 'none') as 'none' | 'llm' | 'decision'
const cut = Number(env('BENCH_GATE_CUT', '0.5'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.7')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
  decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision', confidence: 0.7 },
}

interface Result { id: string; kind: string; language: Language; run: number; first: Problem[]; refused: boolean; gated: boolean; attempts: number; final: Problem[]; situation?: string; failed?: string }
const results: Result[] = []

const clean = (rows: Result[], which: 'first' | 'final'): number => rows.filter(row => row.failed === undefined && !row[which].some(problem => problem.rule === 'leak')).length
function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({
    runs: rows.length, failed: rows.filter(row => row.failed !== undefined).length,
    firstWithoutLeak: clean(rows, 'first'), finalWithoutLeak: clean(rows, 'final'), refused: rows.filter(row => row.refused).length, gated: rows.filter(row => row.gated).length, attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
    dropped: rows.filter(row => row.final.some(problem => problem.rule === 'dropped')).length, askedAway: rows.filter(row => row.first.some(problem => problem.rule === 'asked-away')).length,
  })
  return { label, variant, gate: gateMode, cut, llm: base.llm.model, all: by(results), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries(SITUATION_CASES.map(made => [made.kind, by(results.filter(row => row.kind === made.kind))])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `situation-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the situation benchmark cases', () => {
  it('build in both languages with the scene, the message and the instructions, and name only the cast', () => {
    expect(new Set(SITUATION_CASES.map(made => made.id)).size).toBe(SITUATION_CASES.length)
    for (const made of SITUATION_CASES) {
      for (const language of LANGUAGES) {
        const built = build(made, language, 'new')
        expect(built.prompt, `${made.id} ${language}`).toContain(made.input(language))
        expect(built.persona, `${made.id} ${language}`).toMatch(language === 'en' ? /as fact and know nothing else/ : /当作事实/)
        expect(build(made, language, 'old').persona, `${made.id} ${language} old`).not.toMatch(language === 'en' ? /as fact and know nothing else/ : /当作事实/)
        expect(made.keeps(language).length, made.id).toBeGreaterThan(0)
      }
    }
  })

  it('judges a situation by who is named and what only the thought holds, and finds what the engine would send back', () => {
    const made = SITUATION_CASES.find(candidate => candidate.id === 'aside')!
    expect(score({ characters: ['elias'], situation: 'Mara agrees to the dinner if it makes him feel better.' }, made, 'en')).toEqual([])
    expect(score({ characters: ['elias'], situation: 'Mara agrees to dinner, thinking of Odile.' }, made, 'en').map(problem => problem.rule)).toEqual(['leak'])
    expect(score({ characters: ['elias', 'pavel'], situation: 'Mara agrees to dinner if it makes him feel better.' }, made, 'en').map(problem => problem.rule)).toEqual(['asked-away'])
    const built = build(made, 'en', 'new')
    expect(refusal(built, { characters: ['elias'], situation: 'Mara agrees to dinner, thinking of Odile.' }, new Map())).toMatch(/Elias has no way of knowing Odile/)
    expect(refusal(built, { characters: ['elias'], situation: 'Mara agrees to dinner with Pavel\'s cousin.' }, new Map())).toBeUndefined()
  })
})

describe.skipIf(!live)(`the situation benchmark, live (${label}, ${variant} instructions)`, () => {
  for (const language of languages) {
    for (const made of SITUATION_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const counters = newCounters(trace)
          const context = liveContext(base, language, counters)
          const built = build(made, language, variant)
          const row: Result = { id: made.id, kind: made.kind, language, run, first: [], refused: false, gated: false, attempts: 0, final: [] }
          try {
            const ask = async (prompt: string) => await context.run({ persona: built.persona, prompt, result: ACTIVATION_SCHEMA } as never) as { characters?: string[]; reaches?: { character: string; how: string }[]; situation?: string }
            const faulty = async (situation: string): Promise<boolean> => {
              const input = made.input(language)
              if (gateMode === 'llm') {
                const verdict = await context.run({ persona: `${shippedText('roleplay/gate-situation', language)}\n\nGive your reason in one short sentence first, then say whether the passage has the fault.`, prompt: `The player's character: ${castName('mara', language)}\n\nThe player's message:\n${input}\n\nThe situation to check:\n${situation}`, result: { type: 'object', properties: { reason: { type: 'string' }, fault: { type: 'boolean' } }, required: ['reason', 'fault'], additionalProperties: false } } as never) as { fault: boolean }
                return verdict.fault
              }
              const asked = await liveDecisionService(base.decision!, counters).decide({ player_character: castName('mara', language), player_message: input, situation }, { fault: { type: 'noul', instructions: shippedText('roleplay/gate-situation', language) } })
              return asked.answers['fault']!.probability >= cut
            }
            const refused = new Map<string, number>()
            let notes = ''
            let last = await ask(built.prompt)
            row.attempts = 1
            row.first = score(last, made, language)
            if (last.situation !== undefined) row.situation = last.situation
            for (let guard = 0; guard < 6; guard += 1) {
              const problem = refusal(built, last, refused)
              if (problem !== undefined) { row.refused = true; notes += `\n\nYour call was refused: ${problem}`; last = await ask(`${built.prompt}${notes}\n\nCall it again.`); row.attempts += 1; continue }
              if (gateMode !== 'none' && !row.gated && last.situation !== undefined && await faulty(last.situation)) { row.gated = true; notes += `\n\nYour call was refused: ${GATE_MESSAGE}`; last = await ask(`${built.prompt}${notes}\n\nCall it again.`); row.attempts += 1; continue }
              break
            }
            row.final = score(last, made, language)
            trace.event('expect', { first: row.first, refused: row.refused, gated: row.gated, final: row.final, situation: last.situation })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
