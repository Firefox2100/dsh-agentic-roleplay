import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { liveContext, liveDecisionService, newCounters, type LiveOptions } from './live.ts'
import { Trace } from './trace.ts'
import { ALL_SITE_CASES as OWN_SITE_CASES, HELDOUT_SITE_CASES, SITES, type Site, type SiteCase } from './sites-cases.ts'
import { shippedText } from '../../src/host/prompts/library.ts'

/**
 * The decision-site benchmark: every yes-or-no judgement the product asks a model (the output checks, the rule check, errands, messages, the statements triggers wait on, the belief check of reflection),
 * as labelled cases in both languages, put through the site's own shipped question to the decision model (its probability against the site's cut) and to the language model reading the same
 * question. Held to accuracy, with the faults found and the false alarms apart. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_LABEL=sites1 BENCH_REPEAT=2 BENCH_MODES=decision,llm npx vitest run tests/benchmark/sites.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const ALL_SITE_CASES = process.env['BENCH_SET'] === 'heldout' ? HELDOUT_SITE_CASES : OWN_SITE_CASES
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'sites')
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const modes = env('BENCH_MODES', 'decision,llm').split(',') as ('decision' | 'llm')[]
const only = env('BENCH_SITES', '').split(',').filter(site => site !== '') as Site[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const base: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: Number(env('BENCH_TEMPERATURE', '0.2')), reasoning: env('BENCH_REASONING', 'none') },
  concurrency: 2,
  decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode: 'decision', confidence: 0.7 },
}

const RESULT = { type: 'object', properties: { reason: { type: 'string', description: 'One short sentence, written first.' }, yes: { type: 'boolean', description: 'The answer to the question.' } }, required: ['reason', 'yes'], additionalProperties: false } as never
const ANSWER = 'Give your reason in one short sentence first, then answer yes or no with the result tool.'
/** As the product's gates ask the language model: the fault is named, so a yes cannot be read as a yes to something else. */
const FAULT_RESULT = { type: 'object', properties: { reason: { type: 'string', description: 'One short sentence, written first: what the passage does, and whether that is the fault.' }, yes: { type: 'boolean', description: 'Whether the passage has the fault.' } }, required: ['reason', 'yes'], additionalProperties: false } as never
const FAULT_ANSWER = 'Give your reason in one short sentence first, then say whether the passage has the fault.'
const faultStyle = process.env['BENCH_SCHEMA'] === 'fault'

interface Result { id: string; site: Site; language: Language; mode: 'decision' | 'llm'; run: number; yes: boolean; said: boolean; probability?: number; failed?: string }
const results: Result[] = []

function summarise(): Record<string, unknown> {
  const by = (rows: Result[]) => {
    const judged = rows.filter(row => row.failed === undefined)
    const found = judged.filter(row => row.yes && row.said).length
    const missed = judged.filter(row => row.yes && !row.said).length
    const alarms = judged.filter(row => !row.yes && row.said).length
    const clear = judged.filter(row => !row.yes && !row.said).length
    return { runs: rows.length, failed: rows.length - judged.length, found, missed, alarms, clear, accuracy: judged.length === 0 ? undefined : (found + clear) / judged.length }
  }
  const sites = [...new Set(results.map(row => row.site))]
  return { label, decision: base.decision?.model, llm: base.llm.model, ...Object.fromEntries(modes.map(mode => [mode, { all: by(results.filter(row => row.mode === mode)), ...Object.fromEntries(sites.map(site => [site, by(results.filter(row => row.mode === mode && row.site === site))])), ...Object.fromEntries(LANGUAGES.map(language => [language, by(results.filter(row => row.mode === mode && row.language === language))])) }])) }
}

afterAll(() => {
  if (!live || results.length === 0) return
  const file = join(out, `sites-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary: summarise(), results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summarise(), null, 1)}`)
})

const question = (made: SiteCase, language: Language): { state: Record<string, unknown>; instructions: string } => {
  const view = made.view(language)
  const own = SITES[made.site].own
  return { state: view.state, instructions: own === undefined ? shippedText(SITES[made.site].prompt, language, view.vars) : own[language] }
}

describe('the decision-site benchmark cases', () => {
  it('cover every site with faults and clean cases in both languages, each with a question the shipped prompt can fill', () => {
    expect(new Set(ALL_SITE_CASES.map(made => made.id)).size).toBe(ALL_SITE_CASES.length)
    for (const site of new Set(ALL_SITE_CASES.map(made => made.site))) {
      const own = ALL_SITE_CASES.filter(made => made.site === site)
      expect(own.filter(made => made.yes).length, site).toBeGreaterThanOrEqual(3)
      expect(own.filter(made => !made.yes).length, site).toBeGreaterThanOrEqual(3)
    }
    for (const made of ALL_SITE_CASES) for (const language of LANGUAGES) {
      const asked = question(made, language)
      expect(asked.instructions.length, made.id).toBeGreaterThan(50)
      expect(asked.instructions, made.id).not.toContain('${')
      expect(JSON.stringify(asked.state).length, made.id).toBeGreaterThan(20)
    }
  })
})

describe.skipIf(!live)(`the decision-site benchmark, live (${label})`, () => {
  for (const mode of modes) for (const language of languages) for (const made of ALL_SITE_CASES.filter(candidate => only.length === 0 || only.includes(candidate.site))) {
    for (let run = 1; run <= repeat; run += 1) {
      it(`${mode} ${language} ${made.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
        const trace = process.env['BENCH_TRACE'] === '0' ? Trace.off : Trace.open(join(out, 'traces', label), `${mode}-${language}-${made.id}-${run}`, { id: made.id, label, language, run })
        const counters = newCounters(trace)
        const row: Result = { id: made.id, site: made.site, language, mode, run, yes: made.yes, said: false }
        const asked = question(made, language)
        try {
          if (mode === 'decision') {
            const service = liveDecisionService(base.decision!, counters)
            const { answers } = await service.decide(asked.state, { answer: { type: 'noul', instructions: asked.instructions } })
            row.probability = answers['answer']!.probability
            row.said = row.probability >= SITES[made.site].cut
          } else {
            const context = liveContext(base, language, counters)
            const answer = await context.run({ persona: `${asked.instructions}\n\n${faultStyle ? FAULT_ANSWER : ANSWER}`, prompt: JSON.stringify(asked.state, null, 1), result: faultStyle ? FAULT_RESULT : RESULT, maxTokens: 2000 } as never) as { yes?: boolean }
            row.said = answer.yes === true
          }
          trace.event('expect', { yes: made.yes, said: row.said, probability: row.probability })
        } catch (error) { row.failed = error instanceof Error ? error.message : String(error) }
        results.push(row)
      }, 300_000)
    }
  }
})
