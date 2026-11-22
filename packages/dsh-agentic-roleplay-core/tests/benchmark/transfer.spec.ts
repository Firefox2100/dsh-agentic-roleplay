import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { build, outcomesSchema, score, type Problem } from './transfer.ts'
import { TRANSFER_CASES } from './transfer-cases.ts'

/**
 * The transfer benchmark: when an outcome has a thing change hands or place, the game master has to record it in item_changes, or the story's records and its narration part ways. The game master's
 * real instructions and scene, the player's message and Elias's answer are given as one request that answers with the arguments of resolve_round (no tool loop; confirm on the rig). Variants: BENCH_VARIANT=old
 * leaves out the sentence the prompt gained and the `from` of a take. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=transfer1 BENCH_VARIANT=new BENCH_REPEAT=4 npx vitest run tests/benchmark/transfer.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'transfer')
const variant = env('BENCH_VARIANT', 'new') as 'old' | 'new'
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.7')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

interface Result { id: string; kind: string; language: Language; run: number; problems: Problem[]; refused: number; failed?: string }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, failed: rows.filter(row => row.failed !== undefined).length, held: rows.filter(row => row.failed === undefined && row.problems.length === 0).length, refusedFirst: rows.filter(row => row.refused > 0).length, byRule: Object.fromEntries(['unrecorded', 'wrong', 'spurious', 'unreadable'].map(rule => [rule, rows.filter(row => row.problems.some(problem => problem.rule === rule)).length])) })
  return { label, variant, llm: base.llm.model, all: by(results), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries(TRANSFER_CASES.map(made => [made.kind, by(results.filter(row => row.kind === made.kind))])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `transfer-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

describe('the transfer benchmark cases', () => {
  it('build in both languages with the scene, the items and what Elias did, and the old variant leaves the sentence out', () => {
    for (const made of TRANSFER_CASES) {
      for (const language of LANGUAGES) {
        const fresh = build(made, language, 'new')
        expect(fresh.prompt, `${made.id} ${language}`).toContain(made.input(language))
        expect(fresh.prompt, `${made.id} ${language}`).toMatch(language === 'en' ? /Storeroom key/ : /储藏室钥匙/)
        expect(fresh.persona).toMatch(language === 'en' ? /a summary alone changes nothing/ : /不会改变故事的记录/)
        expect(build(made, language, 'old').persona).not.toMatch(language === 'en' ? /a summary alone changes nothing/ : /不会改变故事的记录/)
      }
    }
  })

  it('judges the records the outcome would make', () => {
    const made = TRANSFER_CASES.find(candidate => candidate.id === 'snatch')!
    const fresh = () => build(made, 'en', 'new').story
    expect(score({ outcomes: [{ character: 'mara', item_changes: [{ item: 'key: Storeroom key', action: 'take', from: 'elias' }] }] }, made, fresh())).toEqual({ problems: [], refused: 0 })
    expect(score({ outcomes: [{ character: 'mara', summary: 'takes the key' }] }, made, fresh()).problems.map(problem => problem.rule)).toEqual(['unrecorded'])
    expect(score({ outcomes: [{ character: 'mara', item_changes: [{ item: 'key', action: 'take' }] }] }, made, fresh())).toMatchObject({ refused: 1, problems: [{ rule: 'wrong' }] })
    expect(score({ outcomes: [{ character: 'elias', item_changes: [{ item: 'Storeroom key', action: 'drop' }] }] }, TRANSFER_CASES.find(candidate => candidate.id === 'none')!, fresh()).problems.map(problem => problem.rule)).toEqual(['spurious'])
  })
})

describe.skipIf(!live)(`the transfer benchmark, live (${label}, ${variant})`, () => {
  for (const language of languages) {
    for (const made of TRANSFER_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const context = liveContext(base, language, newCounters(trace))
          const { persona, prompt, story } = build(made, language, variant)
          const row: Result = { id: made.id, kind: made.kind, language, run, problems: [], refused: 0 }
          try {
            const answer = await context.run({ persona, prompt, result: outcomesSchema(variant === 'new') } as never)
            const scored = score(answer as never, made, story)
            row.problems = scored.problems
            row.refused = scored.refused
            trace.event('expect', { problems: row.problems, refused: row.refused, answer })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
