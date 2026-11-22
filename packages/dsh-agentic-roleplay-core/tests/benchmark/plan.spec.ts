import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { InvalidEditError, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { build } from './situation.ts'
import { SET_TRIGGER_DESCRIPTION } from '../../src/host/orchestration/trigger-tools.ts'
import { PLAN_CASES, asSituation, type PlanCase } from './plan-cases.ts'

/**
 * The planning benchmark: whether the game master plans a trigger for a moment the story is bound to reach, and only then, and whether what it plans is valid under the story's own checks. The
 * game master's real instructions and scene are given as one request that answers with the triggers it would set before anything else (no tool loop; confirm on the rig). Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=plan1 BENCH_REPEAT=4 npx vitest run tests/benchmark/plan.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'plan')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.7')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
}

const SCHEMA = {
  type: 'object',
  properties: {
    triggers: {
      type: 'array',
      description: 'The triggers you would set with set_trigger before anything else this turn: none when the story has set up no moment that is bound to come.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' }, name: { type: 'string' },
          when: { type: 'object', additionalProperties: true, description: 'The condition: {type:"time", from:"1912-10-05T21:00"}, {type:"place", character, location}, {type:"item", item, holder?}, {type:"event", ...}, or all/any/not of them. Keys are the ones the scene shows.' },
          effects: { type: 'array', items: { type: 'object', additionalProperties: true, description: '{type:"beat", text} or {type:"cue", text, characters?} or {type:"edit", edit:{...}}.' } },
        },
        required: ['key', 'name', 'when', 'effects'],
        additionalProperties: true,
      },
    },
  },
  required: ['triggers'],
  additionalProperties: false,
}

interface Result { id: string; kind: string; language: Language; run: number; planned: number; invalid: string[]; failed?: string }
const results: Result[] = []
const good = (row: Result, made: PlanCase): boolean => row.failed === undefined && (made.kind === 'plan' ? row.planned > 0 && row.invalid.length === 0 : row.planned === 0)

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, failed: rows.filter(row => row.failed !== undefined).length, right: rows.filter(row => good(row, PLAN_CASES.find(made => made.id === row.id)!)).length, invalid: rows.filter(row => row.invalid.length > 0).length })
  return { label, llm: base.llm.model, all: by(results), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries(PLAN_CASES.map(made => [made.id, by(results.filter(row => row.id === made.id))])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `plan-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

/** What the story's own checks say of the triggers a model proposed: made in a fresh story, so every key and condition is held to what exists. */
function problemsOf(proposed: unknown[], story: ReturnType<typeof build>['session']): string[] {
  try { story.edit(parseRecordsEdit({ turn: 3, triggers: proposed })) } catch (error) { return error instanceof InvalidEditError ? [...error.problems] : [error instanceof Error ? error.message : String(error)] }
  return []
}

describe('the planning benchmark cases', () => {
  it('build in both languages and judge a plan by the story\'s own checks', () => {
    for (const made of PLAN_CASES) for (const language of LANGUAGES) expect(build(asSituation(made), language, 'new').prompt).toContain(made.input(language))
    const story = build(asSituation(PLAN_CASES[0]!), 'en', 'new').session
    expect(problemsOf([{ key: 'rent-due', name: 'Rent', when: { type: 'time', from: '1912-10-05T12:00' }, effects: [{ type: 'beat', text: 'The landlord comes for the rent.' }] }], story)).toEqual([])
    expect(problemsOf([{ key: 'ghost', name: 'Ghost', when: { type: 'place', character: 'ghost', location: 'kitchen' }, effects: [{ type: 'beat', text: 'x' }] }], story).length).toBeGreaterThan(0)
  })
})

describe.skipIf(!live)(`the planning benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of PLAN_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const context = liveContext(base, language, newCounters(trace))
          const built = build(asSituation(made), language, 'new')
          const tail = language === 'en' ? 'Now call activate_characters: answer with its arguments.' : '现在调用 activate_characters：给出它的参数。'
          const instead = process.env[language === 'en' ? 'BENCH_5C_EN' : 'BENCH_5C_ZH']
          const persona = instead === undefined ? built.persona : built.persona.replace(/^5c\. .*$/m, instead)
          const ask = language === 'en' ? 'Before anything else: list the triggers you would set with set_trigger this turn, none when there is nothing to plan.' : '先做这件事：列出这一回合你会用 set_trigger 设定的触发器，没有要计划的就留空。'
          const row: Result = { id: made.id, kind: made.kind, language, run, planned: 0, invalid: [] }
          try {
            const answer = await context.run({ persona, prompt: built.prompt.replace(tail, `${language === 'en' ? 'One of your tools:' : '你的一个工具：'}\nset_trigger: ${SET_TRIGGER_DESCRIPTION}\n\n${ask}`), result: SCHEMA } as never) as { triggers?: unknown[] }
            const proposed = Array.isArray(answer.triggers) ? answer.triggers : []
            row.planned = proposed.length
            row.invalid = proposed.length === 0 ? [] : problemsOf(proposed, built.session)
            trace.event('expect', { planned: row.planned, invalid: row.invalid, answer })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
