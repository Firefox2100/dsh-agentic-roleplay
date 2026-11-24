import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createSessionStore } from '@dsh-agentic-roleplay/state'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { live } from './helpers-run.ts'
import { PLAYER_PART_QUESTION } from './judges.ts'
import { HELDOUT_HELPER_CASES, HELPER_CASES as OWN_HELPER_CASES, type HelperCase } from './helpers-cases.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import { wrongLanguage } from '../../src/host/translate/language.ts'
import { hookChecks } from '../../src/host/decisions/extras.ts'

vi.mock('../../src/host/agents/child.ts', async () => ({ runChild: (await import('./helpers-run.ts')).runChildMock, childModel: () => ({}), childSampling: () => ({}), childTrace: () => undefined }))
vi.mock('../../src/host/prompts/access.ts', async () => ({ promptFor: (await import('./helpers-run.ts')).promptForMock }))

const { suggestionWriter } = await import('../../src/host/orchestration/suggester.ts')
const { suggestionProblems } = await import('../../src/host/orchestration/suggestions.ts')
const { foldSummaries } = await import('../../src/host/compaction/chronicle.ts')
const { childChronicler } = await import('../../src/host/compaction/chronicler.ts')
const { factionStrategist } = await import('../../src/host/factions/strategist.ts')
const { authorPlot } = await import('../../src/host/pacing/author.ts')
const { shippedText } = await import('../../src/host/prompts/library.ts')

/**
 * The helper benchmark: the model-written helpers of the product, each run through its own code with only the call to the model pointed at the live model: the suggester, the chronicler (digest, chapter and
 * condensing, through `foldSummaries`), the faction strategist and the plot author. Each case is held to what a result must be (valid, in the language, from the material and nothing else), by code where
 * code can tell and by a second request that sees only the result and the material where it cannot. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=helpers1 BENCH_REPEAT=3 npx vitest run tests/benchmark/helpers.spec.ts
 */
const run = process.env['BENCH_LIVE'] !== undefined
const HELPER_CASES = process.env['BENCH_SET'] === 'heldout' ? HELDOUT_HELPER_CASES : OWN_HELPER_CASES
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'helpers')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const only = env('BENCH_HELPERS', '').split(',').filter(name => name !== '')
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.4')), reasoning: env('BENCH_REASONING', 'none') },
  ...process.env['BENCH_HOOKS'] === undefined ? {} : { decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision' as const, confidence: 0.7 } },
  concurrency: 2,
}

interface Result { id: string; helper: HelperCase['helper']; language: Language; run: number; right: boolean; problems: string[]; failed?: string }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => ({ runs: rows.length, failed: rows.filter(row => row.failed !== undefined).length, right: rows.filter(row => row.right).length })
  const names = [...new Set(results.map(row => row.helper))]
  return { label, llm: base.llm.model, all: by(results), ...Object.fromEntries(names.map(name => [name, by(results.filter(row => row.helper === name))])), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.language === language))])), ...Object.fromEntries(HELPER_CASES.map(made => [made.id, by(results.filter(row => row.id === made.id))])) }
}

afterAll(() => {
  if (!run || results.length === 0) return
  const file = join(out, `helpers-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

/** The fault is named in the answer itself, so that a yes cannot be read as a yes to something else (a generic yes was read as "supported" and inverted the verdicts). */
const judgeResult = (fault: string) => ({ type: 'object', properties: { reason: { type: 'string', description: 'One short sentence, written first: what you found, and whether it is the fault.' }, yes: { type: 'boolean', description: `Whether this fault is there: ${fault}` } }, required: ['reason', 'yes'], additionalProperties: false }) as never

/** A yes-or-no question about a result, kept until the generation phase is over so that the server does not swap models between a helper's request and the judge's. */
interface Pending { question: string; text: string; problem: string; fault?: string }
type Later = (question: string, text: string, problem: string, fault?: string) => void

/** The server may still be loading the judging model when the first question arrives (503): wait for it rather than lose the row. */
async function judgeAll(pending: Pending[], context: NonNullable<typeof live.context>): Promise<string[]> {
  const found: string[] = []
  for (const entry of pending) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const answer = await context.run({ persona: `${entry.question} Answer with the result tool: say why in one short sentence, then say whether the fault is there.`, prompt: entry.text, result: judgeResult(entry.fault ?? entry.problem), maxTokens: 2000 } as never) as { yes?: boolean; reason?: string }
        if (answer.yes === true) found.push(`${entry.problem} (${answer.reason ?? ''})`)
        break
      } catch (error) {
        if (attempt >= 8 || !/\b50[0-9]\b/.test(String(error))) throw error
        await new Promise(resolve => setTimeout(resolve, 20_000))
      }
    }
  }
  return found
}

const agent = {} as Agent
const settingsOf = (language: Language, extra: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, prompts: { language }, ...extra })

const executors: Record<HelperCase['helper'], (made: HelperCase, language: Language, later: Later) => Promise<string[]>> = {
  suggester: async (made, language, _later) => {
    const fixture = made.suggester!(language)
    const writer = suggestionWriter({ agentOf: () => agent })
    const options = await writer.suggest({ chat: 'bench', turn: 3, count: 3, output: { segments: fixture.segments, repaired: false }, store: { settings: () => settingsOf(language), cast: () => fixture.cast } as never }, new AbortController().signal)
    const problems = suggestionProblems(options, 3)
    const text = options.join('\n')
    const wrong = wrongLanguage(language, Object.fromEntries(options.map((line, index) => [`option ${index + 1}`, line])))
    if (wrong !== undefined) problems.push(wrong)
    for (const name of fixture.forbidden) if (text.includes(name)) problems.push(`mentions ${name}, who is not in what was read`)
    for (const line of options) if (line.startsWith(fixture.player)) problems.push(`written about the character, not as the player's own move: ${line}`)
    return problems
  },
  chronicler: async (made, language, later) => {
    const fixture = made.chronicler!(language)
    const story = createSessionStore(':memory:', { id: 'bench-chronicle', name: 'Chronicle', world: { id: 'w', name: 'W' } })
    try {
      for (const event of fixture.events) story.events.add({ turn: event.turn, round: 1, text: event.text, importance: event.importance, tags: [], involves: [] }, [])
      for (const summary of fixture.summaries) story.summaries.add(summary)
      const text = (id: 'digest' | 'chapter' | 'condense', variables: Record<string, string | number>): string => shippedText(`roleplay/chronicle-${id}`, language, variables as never)
      await foldSummaries({ story: story as never, settings: { ...DEFAULT_SETTINGS.context, ...fixture.limits }, uptoTurn: fixture.uptoTurn, playerInputs: fixture.playerInputs, transcript: '', account: env('BENCH_ACCOUNT', 'written') as 'written' | 'events', chronicler: childChronicler(agent, settingsOf(language) as never), text, signal: new AbortController().signal })
      const written = story.summaries.list().filter(summary => summary.level === fixture.level)
      const latest = written.at(-1)
      if (latest === undefined) return [`no ${fixture.level} was written`]
      const problems: string[] = []
      for (const word of fixture.keeps) if (!latest.text.includes(word)) problems.push(`lost "${word}"`)
      for (const word of fixture.lacks) if (latest.text.includes(word)) problems.push(`kept "${word}", which the events correct or the story never had`)
      const wrong = wrongLanguage(language, { summary: latest.text })
      if (wrong !== undefined) problems.push(wrong)
      if (/\b(turns?|ids?)\s*\d+/i.test(latest.text) || /第\s*\d+\s*回合/.test(latest.text)) problems.push('refers to turns or ids')
      const sources = [`Events (authoritative):\n${fixture.events.map(event => `- ${event.text}`).join('\n')}`, fixture.playerInputs.trim() === '' ? '' : `What the player did:\n${fixture.playerInputs}`].filter(part => part !== '').join('\n\n')
      const sentences = latest.text.split(/(?<=[.!?。！？])\s*/u).map(sentence => sentence.trim()).filter(sentence => sentence.length > 3)
      for (const sentence of sentences) later('Here are the recorded events of a story and what the player did. Does the sentence below say anything they do not support: a person, thing, place, number or happening that is neither stated in them nor follows directly from them? Where it says what the player did, what the player did supports it.', `${sources}\n\nSentence:\n${sentence}`, `a sentence the events do not support: ${sentence.slice(0, 80)}`, 'the sentence says something the events do not support')
      return problems
    } finally { story.close() }
  },
  strategist: async (made, language, later) => {
    const fixture = made.strategist!(language)
    const story = createSessionStore(':memory:', { id: 'bench-strategy', name: 'Strategy', world: { id: 'w', name: 'W' } })
    try {
      const faction = story.factions.add({ sourceId: 'guild', name: fixture.name, aliases: [], summary: fixture.summary, description: '', values: fixture.values, structure: '' })
      story.factionStates.create(faction.id, { publicState: fixture.publicState, innerState: fixture.innerState })
      const goals = fixture.goals.map(goal => story.factionIntents.add(faction.id, { type: 'agenda', name: goal.name, description: goal.description, status: 'active', horizon: 'short', priority: 0.6, urgency: 0.5, plan: goal.plan, openThreads: [], constraints: [] } as never))
      fixture.events.forEach((text, index) => story.events.add({ turn: index + 1, round: 1, text, importance: 3, tags: [], involves: [] }, []))
      const now = Date.UTC(1912, 9, 12, 9)
      story.metadata.setValue('strategy.last', { guild: now - 10 * 24 * 60 * 60 * 1000 })
      const store = { story, settings: () => settingsOf(language, { factions: { perTurn: 1, everyDays: 3 } }), time: () => ({ now, zone: 'UTC' }) }
      const done = await factionStrategist({ agentOf: () => agent }).strategize({ chat: 'bench', turn: 5, store } as never, new AbortController().signal)
      const problems: string[] = []
      const summary = done.acted[0]?.summary ?? ''
      if (summary.trim() === '') problems.push('no decision was made')
      if (summary.length > 400) problems.push('the summary is too long')
      const wrong = wrongLanguage(language, { summary })
      if (wrong !== undefined) problems.push(wrong)
      const states = goals.map(goal => story.factionIntents.list(faction.id).find(entry => entry.id === goal.id)?.status)
      if (fixture.expectStatus === 'active' && states.some(state => state !== 'active')) problems.push(`a goal was ended without the story saying so (${states.join(', ')})`)
      if (fixture.expectStatus === 'completed' && states[0] !== 'completed') problems.push(`the goal the story fulfilled is ${states[0]}`)
      if (fixture.expectStatus === 'ended' && !['failed', 'abandoned', 'paused'].includes(states[0] ?? '')) problems.push(`the goal the story made impossible is ${states[0]}`)
      later('You read what one organisation of an interactive story did in the time that passed. Does the text decide what a person with a name of their own does, says, thinks or feels, instead of what the organisation does as a whole? A role (a clerk, a courier, a member) is not a named person.', summary, 'it decides what a named person does')
      return problems
    } finally { story.close() }
  },
  plot: async (made, language, later) => {
    const fixture = made.plot!(language)
    const story = createSessionStore(':memory:', { id: 'bench-plot', name: 'Plot', world: { id: 'w', name: 'W' } })
    try {
      for (const character of fixture.cast) story.characters.add({ sourceId: character.key, name: character.name, aliases: [], kind: 'person', tier: 'principal', role: character.player ? 'playable' : 'npc', control: character.player ? 'player' : 'agent', summary: character.summary, personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
      story.factions.add({ sourceId: 'guild', name: fixture.faction.name, aliases: [], summary: fixture.faction.summary, description: '', values: [], structure: '' })
      story.locations.add({ sourceId: 'kitchen', name: fixture.place, description: '', features: [] })
      fixture.events.forEach((text, index) => story.events.add({ turn: index + 1, round: 1, text, importance: 3, tags: [], involves: [] }, []))
      const store = { story, settings: () => settingsOf(language), text: (id: string) => shippedText(id, language, {}), cast: () => story.characters.list().map(character => ({ key: character.sourceId!, character })) }
      const asked = live.context?.decide
      const hooks = asked === undefined ? undefined : { chat: 'bench', check: hookChecks({ decisions: () => ({ decide: async (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => { const answers = await asked(state, Object.entries(questions).map(([key, question]) => ({ key, instructions: question.instructions }))); return { answers: Object.fromEntries([...answers].map(([key, probability]) => [key, { type: 'noul', probability }])) } } }) as never }) }
      const plot = await authorPlot(agent, store as never, 6, new AbortController().signal, hooks)
      const problems: string[] = []
      const keys = new Set(fixture.cast.map(character => character.key))
      for (const who of plot.participants) if (!keys.has(who) && who !== 'guild') problems.push(`names ${who}, who is not in the story`)
      const text = JSON.stringify(plot)
      if (!fixture.uses.some(word => text.includes(word))) problems.push('builds on nothing that is in the story')
      const wrong = wrongLanguage(language, { premise: plot.premise })
      if (wrong !== undefined) problems.push(wrong)
      const player = fixture.cast.find(character => character.player)!.name
      const units = [...plot.hooks, ...plot.developments].map(entry => `${entry.text} ${entry.guidance}`).concat(plot.resolutions)
      const others = fixture.cast.filter(character => !character.player).map(character => character.name).join(', ')
      for (const unit of units) later(PLAYER_PART_QUESTION[language], `The player's character: ${player}\nThe other characters, who are not the player's character: ${others}\n\nPassage:\n${unit}`, `a passage makes the player's character act: ${unit.slice(0, 90)}`, `the passage makes ${player}, the player's character and nobody else, act, speak, decide or feel`)
      const settled = `Events:\n${fixture.events.map(event => `- ${event}`).join('\n')}`
      for (const unit of plot.hooks.map(entry => `${entry.text} ${entry.guidance}`)) later('You read the hook of a plot scaffold for an interactive story, and the events recorded so far. A hook proposes what could come up next, so something new is fine, even in the present tense. Does the hook contradict the events (it treats something they settled as still open, or undoes it), or state as already past something they do not record? Restating a recorded event is not a fault; only what the hook adds or changes is.', `${settled}\n\nHook:\n${unit}`, `a hook contradicts or invents the past: ${unit.slice(0, 90)}`, 'the hook contradicts the events, or states as already past something they do not record')
      return problems
    } finally { story.close() }
  },
}

describe('the helper benchmark cases', () => {
  it('give every helper cases in both languages, with something it must keep and something it must not do', () => {
    expect(new Set(HELPER_CASES.map(made => made.id)).size).toBe(HELPER_CASES.length)
    for (const helper of new Set(HELPER_CASES.map(made => made.helper))) expect(HELPER_CASES.filter(made => made.helper === helper).length, helper).toBeGreaterThanOrEqual(2)
    for (const made of HELPER_CASES) for (const language of LANGUAGES) {
      if (made.suggester) { const fixture = made.suggester(language); expect(fixture.segments.length, made.id).toBeGreaterThan(0); expect(fixture.forbidden.length, made.id).toBeGreaterThan(0) }
      if (made.chronicler) { const fixture = made.chronicler(language); expect(fixture.events.length, made.id).toBeGreaterThan(2); expect(fixture.keeps.length, made.id).toBeGreaterThan(0) }
      if (made.strategist) expect(made.strategist(language).goals.length, made.id).toBeGreaterThan(0)
      if (made.plot) expect(made.plot(language).cast.some(character => character.player), made.id).toBe(true)
    }
  })
})

describe.skipIf(!run)(`the helper benchmark, live (${label})`, () => {
  const queued = new Map<Result, Pending[]>()
  const again = process.env['BENCH_REJUDGE']
  for (const language of again === undefined ? languages : []) for (const made of HELPER_CASES.filter(candidate => only.length === 0 || only.includes(candidate.helper))) {
    for (let n = 1; n <= repeat; n += 1) {
      it(`${language} ${made.id}${repeat > 1 ? ` #${n}` : ''}`, async () => {
        const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${language}-${made.id}-${n}`, { id: made.id, label, language, run: n })
        live.context = liveContext(base, language, newCounters(trace))
        const row: Result = { id: made.id, helper: made.helper, language, run: n, right: false, problems: [] }
        const pending: Pending[] = []
        try {
          row.problems = await executors[made.helper](made, language, (question, text, problem, fault) => { pending.push({ question, text, problem, ...(fault === undefined ? {} : { fault }) }) })
          row.right = row.problems.length === 0 && pending.length === 0
          trace.event('expect', { problems: row.problems, judged: pending.length })
        } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
        queued.set(row, pending)
        results.push(row)
      }, 900_000)
    }
  }

  it('judges everything that was produced, on the judging model, once the generation is over', async () => {
    const judging = env('BENCH_JUDGE_MODEL', base.llm.model)
    mkdirSync(out, { recursive: true })
    if (again !== undefined) for (const saved of JSON.parse(readFileSync(join(out, `helpers-${again}.pending.json`), 'utf8')) as { row: Result; pending: Pending[] }[]) { saved.row.problems = []; queued.set(saved.row, saved.pending); results.push(saved.row) }
    else writeFileSync(join(out, `helpers-${label}.pending.json`), `${JSON.stringify([...queued].map(([row, pending]) => ({ row, pending })), null, 1)}\n`)
    for (const [row, pending] of queued) {
      if (row.failed !== undefined) continue
      try {
        const context = liveContext({ ...base, llm: { ...base.llm, model: judging, temperature: 0.2 } }, row.language, newCounters(Trace.off))
        row.problems.push(...await judgeAll(pending, context))
        row.right = row.problems.length === 0
      } catch (error) { row.failed = `the judge failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }, 1_800_000)
})
