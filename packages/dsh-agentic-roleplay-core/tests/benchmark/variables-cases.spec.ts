import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './language.ts'
import { alertWord, VARIABLE_CASES, variableDefinitions, type ValueCheck } from './variable-cases.ts'
import { runVariableCase, total } from './variables-harness.ts'

/** A model that knows what each case plants: the harness and the cases must score it perfectly, whatever else is true of the product. */
const oracle = (expected: Record<string, ValueCheck>, language: (typeof LANGUAGES)[number]) => async ({ prompt, result, label }: { prompt: string; result: unknown; label: string }): Promise<unknown> => {
  if (label === 'tracked values') {
    const keys = Object.keys((result as { properties: Record<string, unknown> }).properties)
    return Object.fromEntries(keys.map(key => [key, key in expected]))
  }
  const changes = [...prompt.matchAll(/^- (\S+): .*(?:Now: |现在：)(.+?)[.。]$/gm)].filter(([, key]) => key! in expected).map(([, key, now]) => {
    const check = expected[key!]!
    const started = Number(now)
    const to = 'to' in check ? check.to : 'word' in check ? alertWord(language, check.word) : 'up' in check ? started + 1 : 'down' in check ? started - 1 : 'atMost' in check ? check.atMost : check.atLeast
    return [key!, to] as const
  })
  return Object.fromEntries(changes)
}

describe('the tracked-value benchmark', () => {
  it('has each case in both languages, with unique ids and the values it names declared', () => {
    expect(new Set(VARIABLE_CASES.map(benchmark => benchmark.id)).size).toBe(VARIABLE_CASES.length)
    const declared = new Set(variableDefinitions('en').map(def => def.key))
    expect(variableDefinitions('zh').map(def => def.key)).toEqual(variableDefinitions('en').map(def => def.key))
    for (const benchmark of VARIABLE_CASES) {
      for (const key of [...Object.keys(benchmark.expect), ...Object.keys(benchmark.start ?? {})]) expect(declared, `${benchmark.id} names ${key}`).toContain(key.split(':')[0])
      for (const language of LANGUAGES) expect(benchmark.turn(language).narration.length, `${benchmark.id} ${language}`).toBeGreaterThan(20)
    }
    expect(VARIABLE_CASES.filter(benchmark => benchmark.kind === 'keep').length).toBeGreaterThanOrEqual(8)
  })

  for (const language of LANGUAGES) {
    it(`scores a model that knows the answers perfectly (${language})`, async () => {
      const results = []
      for (const benchmark of VARIABLE_CASES) results.push(await runVariableCase(benchmark, language, { mode: 'llm', ask: oracle(benchmark.expect, language) }))
      const failed = results.filter(result => result.fn > 0 || result.fp > 0 || result.valueWrong > 0 || result.problems.length > 0)
      expect(failed.map(result => ({ case: result.case, problems: result.problems, items: result.items.filter(item => (item.changed !== (item.expected !== undefined) && item.tolerated !== true) || item.valueOk === false) }))).toEqual([])
      expect(total(results).tp).toBe(VARIABLE_CASES.reduce((sum, benchmark) => sum + Object.keys(benchmark.expect).length, 0))
    })
  }

  it('scores a model that says nothing changed as missing every planted change and raising no alarm', async () => {
    const results = []
    for (const benchmark of VARIABLE_CASES) results.push(await runVariableCase(benchmark, 'en', { mode: 'llm', ask: async ({ result }) => Object.fromEntries(Object.keys((result as { properties: Record<string, unknown> }).properties).map(key => [key, false])) }))
    expect(total(results)).toMatchObject({ tp: 0, fp: 0, fn: VARIABLE_CASES.reduce((sum, benchmark) => sum + Object.keys(benchmark.expect).length, 0) })
  })
})
