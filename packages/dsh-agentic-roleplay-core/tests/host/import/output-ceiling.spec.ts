import { describe, expect, it } from 'vitest'
import { autoOutputCeiling, knownOutputCeiling, outputCeiling } from '../../../src/host/import/output-ceiling.ts'

describe('what one request of a helper may write', () => {
  it('is the setting when it names a number, else a tenth of the context window, at least 16000, and a fallback when the window is not known', () => {
    expect(autoOutputCeiling(1_048_576)).toBe(104_858)
    expect(autoOutputCeiling(64_000)).toBe(16_000)
    expect(autoOutputCeiling(undefined)).toBe(32_000)
    expect(knownOutputCeiling(5000)).toBe(5000)
    expect(knownOutputCeiling(0)).toBe(32_000)
  })

  it('asks the model of the helper for its window once, and learns it for the requests that cannot wait', async () => {
    let lookups = 0
    const agent = { session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) }, ctx: { llm: { resolveModelInfo: async () => { lookups += 1; return { context: { contextWindow: 500_000 } } } } } } as never
    const signal = new AbortController().signal
    expect(await outputCeiling(0, agent, undefined, signal)).toBe(50_000)
    expect(await outputCeiling(0, agent, undefined, signal)).toBe(50_000)
    expect(lookups).toBe(1)
    expect(await outputCeiling(12_000, agent, undefined, signal)).toBe(12_000)
    expect(knownOutputCeiling(0, { provider: 'p', model: 'm' })).toBe(50_000)
    const named = { provider: 'q', model: 'n' }
    const failing = { session: { requestHeader: () => undefined }, ctx: { llm: { resolveModelInfo: async () => { throw new Error('unknown') } } } } as never
    expect(await outputCeiling(0, failing, named, signal)).toBe(32_000)
  })
})
