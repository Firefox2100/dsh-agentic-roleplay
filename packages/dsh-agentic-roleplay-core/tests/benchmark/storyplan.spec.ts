import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { InvalidEditError, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { build } from './situation.ts'
import { HELDOUT_PLAN_CASES, STORY_PLAN_CASES as OWN_CASES, type StoryPlanCase } from './storyplan-cases.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { PLAN_RESULT, planBrief, planChecker, softProblem } from '../../src/host/plan/planner.ts'
import { writePlan } from '../../src/host/plan/plan.ts'
import type { TurnStore } from '../../src/host/orchestration/boundaries.ts'
import { asSituation } from './plan-cases.ts'
import { castName } from './attribution-cases.ts'

/**
 * The story-plan benchmark: the planner's real instructions and brief against a story, answered as the planner answers. Held to what a plan must do: revise a plan the player overturned, leave one that still
 * stands, make one from a story that has none, set only beats and cues, and set triggers the story's own checks accept. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=storyplan1 BENCH_REPEAT=4 npx vitest run tests/benchmark/storyplan.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
/** BENCH_SET=heldout (with BENCH_CAST=held) runs the cases that were written after the prompts, with other scenes and names. */
const STORY_PLAN_CASES = process.env['BENCH_SET'] === 'heldout' ? HELDOUT_PLAN_CASES : OWN_CASES
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'storyplan')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') } as LiveOptions['llm'],
  concurrency: 2,
}

interface Answer { unchanged?: boolean; items?: { text: string; forces_player?: boolean; overturned_by?: string }[]; note?: string; triggers?: Record<string, unknown>[] }
interface Result { id: string; kind: StoryPlanCase['kind']; language: Language; run: number; right: boolean; why: string; hard: boolean; invalid: string[]; forced: string[]; failed?: string }
const results: Result[] = []

/** What the answer should have been, by the kind of case, judged by code: a plan still stands when an item holds its driver and its object. */
export function judge(made: StoryPlanCase, language: Language, answer: Answer): { right: boolean; why: string } {
  const items = answer.items ?? []
  const stands = items.some(item => (made.keeps?.(language) ?? []).every(word => item.text.includes(word)))
  if (made.kind === 'holds') return answer.unchanged === true || stands ? { right: true, why: '' } : { right: false, why: 'the plan that still stood was rewritten' }
  if (made.kind === 'revises') return answer.unchanged !== true && !stands ? { right: true, why: '' } : { right: false, why: 'the overturned plan stood' }
  if (made.kind === 'sparse') return { right: true, why: '' }
  if (made.kind === 'free') return items.length > 0 ? { right: true, why: '' } : { right: false, why: 'no plan was made' }
  return items.length > 0 && (answer.note ?? '').trim() !== '' ? { right: true, why: '' } : { right: false, why: 'no plan was made' }
}

const FORCE_JUDGE = 'You read one item of a private plan for an interactive story and say whether it decides something for the player\'s character: what the character does, says, decides or feels as a thing that will happen. An item that only says what the world does, or what follows if the player\'s character chooses something, does not decide anything for the character. Answer with the result tool.'
const FORCE_RESULT = { type: 'object', properties: { reason: { type: 'string', description: 'In a few words, what the item makes the character do or feel, or that it makes none.' }, forced: { type: 'boolean' } }, required: ['reason', 'forced'], additionalProperties: false } as never

/** The items that still decide something for the player's character, by a second request that sees only the item: an independent check of the planner's own answer. */
async function forcedItems(context: ReturnType<typeof liveContext>, language: Language, items: string[]): Promise<string[]> {
  const found: string[] = []
  for (const item of items) {
    const verdict = await context.run({ persona: FORCE_JUDGE, prompt: `The player's character is ${castName('mara', language)}.\nItem: ${item}`, result: FORCE_RESULT, maxTokens: 2000 } as never) as { forced?: boolean }
    if (verdict.forced === true) found.push(item)
  }
  return found
}

const problemsOf = (proposed: unknown[], story: ReturnType<typeof build>['session']): string[] => {
  try { story.edit(parseRecordsEdit({ turn: 3, triggers: proposed })) } catch (error) { return error instanceof InvalidEditError ? [...error.problems] : [error instanceof Error ? error.message : String(error)] }
  return []
}

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, failed: rows.filter(row => row.failed !== undefined).length, right: rows.filter(row => row.right).length, hard: rows.filter(row => row.hard).length, invalid: rows.filter(row => row.invalid.length > 0).length, forced: rows.filter(row => row.forced.length > 0).length })
  return { label, llm: base.llm.model, all: by(results), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries(STORY_PLAN_CASES.map(made => [made.id, by(results.filter(row => row.id === made.id))])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `storyplan-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

const setup = (made: StoryPlanCase, language: Language) => {
  const built = build(asSituation({ id: made.id, kind: 'none', input: () => '' }), language, 'new')
  made.seed(built.session, language)
  const plan = made.plan?.(language)
  if (plan !== undefined) writePlan(built.session, { turn: 1, note: plan.note, items: plan.items.map(item => ({ ...item, triggers: [] })) })
  const store = { ...built.store, settings: () => DEFAULT_SETTINGS, time: () => ({ now: Date.UTC(1912, 9, 4, 20), zone: 'UTC' }), pins: () => [] } as unknown as TurnStore
  const name = language === 'en' ? 'English' : 'Chinese'
  return { built, persona: shippedText('roleplay/planner', language, { language: name }), prompt: planBrief(store, { chat: 'bench', turn: 4, store, reason: made.reason }, made.reason) }
}

describe('the story-plan benchmark cases', () => {
  it('build in both languages, with the plan shown in the brief only where the case has one', () => {
    for (const made of STORY_PLAN_CASES) for (const language of LANGUAGES) {
      const { prompt, persona } = setup(made, language)
      expect(persona.length).toBeGreaterThan(100)
      expect(prompt.includes('There is no plan yet')).toBe(made.plan === undefined)
    }
  })

  it.skipIf(process.env['BENCH_CAST'] === 'held')('judge a plan by what the case needs, and a trigger by the story\'s own checks and the soft rule', () => {
    const [blocked, standing, first] = [OWN_CASES[0]!, OWN_CASES[1]!, OWN_CASES[2]!]
    expect(judge(blocked, 'en', { items: [{ text: 'Pavel still comes for the cart at nine.' }] }).right).toBe(false)
    expect(judge(blocked, 'en', { items: [{ text: 'The harbor master wants a word about the cellar.' }] }).right).toBe(true)
    expect(judge(blocked, 'en', { unchanged: true }).right).toBe(false)
    expect(judge(standing, 'en', { unchanged: true }).right).toBe(true)
    expect(judge(standing, 'en', { items: [{ text: 'Something unrelated entirely.' }] }).right).toBe(false)
    expect(judge(standing, 'zh', { items: [{ text: '吴峰明早九点带着人来到厨房，要求拿走大车抵债。' }] }).right).toBe(true)
    expect(judge(first, 'en', { items: [{ text: 'The landlord comes for the rent.' }], note: 'Keep the clock in view.' }).right).toBe(true)
    expect(judge(first, 'en', { items: [] }).right).toBe(false)
    const free = OWN_CASES.find(made => made.id === 'invited')!
    expect(judge(free, 'en', { items: [{ text: 'The harbor festival draws a crowd.' }] }).right).toBe(true)
    expect(judge(free, 'en', { items: [] }).right).toBe(false)
    expect(softProblem({ triggers: [{ key: 'x', effects: [{ type: 'edit', edit: {} }] }] })).toContain('may not do')
    expect(softProblem({ triggers: [{ key: 'x', effects: [{ type: 'beat', text: 'y' }, { type: 'cue', text: 'z' }] }] })).toBeUndefined()
    const story = setup(first, 'en').built.session
    expect(problemsOf([{ key: 'rent', name: 'Rent', when: { type: 'time', from: '1912-10-05T12:00' }, effects: [{ type: 'beat', text: 'The landlord comes.' }] }], story)).toEqual([])
  })
})

describe.skipIf(!live)(`the story-plan benchmark, live (${label})`, () => {
  for (const language of languages) {
    for (const made of STORY_PLAN_CASES) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${run}`, { id: made.id, label, language, run })
          const context = liveContext(base, language, newCounters(trace))
          const { built, persona, prompt } = setup(made, language)
          const row: Result = { id: made.id, kind: made.kind, language, run, right: false, why: '', hard: false, invalid: [], forced: [] }
          try {
            const answer = await context.run({ persona, prompt, result: PLAN_RESULT, maxTokens: 8000, check: planChecker(built.session, 4, 2) as (value: unknown) => string | undefined } as never) as Answer
            const kept = { ...answer, items: (answer.items ?? []).filter(item => item.forces_player !== true) }
            const verdict = judge(made, language, kept)
            row.forced = await forcedItems(context, language, kept.items.map(item => item.text))
            row.right = verdict.right && row.forced.length === 0
            row.why = row.forced.length > 0 ? `an item decides for the player's character: ${row.forced[0]}` : verdict.why
            row.hard = softProblem(answer) !== undefined
            row.invalid = (answer.triggers ?? []).length === 0 ? [] : problemsOf(answer.triggers!.slice(0, 2), built.session)
            trace.event('expect', { right: row.right, why: row.why, hard: row.hard, invalid: row.invalid, forced: row.forced, answer })
          } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
          results.push(row)
        }, 600_000)
      }
    }
  }
})
