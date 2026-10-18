import { describe, expect, it } from 'vitest'
import { tokensOf } from '../../../src/host/agents/usage.ts'
import { addUsage, readUsage } from '../../../src/host/sessions/usage.ts'

const store = () => { const values = new Map<string, unknown>(); return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } } }
const answered = (usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }) => ({
  type: 'assistant/message',
  data: { stream: [{ type: 'chunk', time: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } }, ...(usage === undefined ? [] : [{ type: 'chunk', time: 2, chunk: { type: 'usage', usage } }])] },
})

describe('the tokens of a session', () => {
  it('are the sum of what the model service reported for the requests it answered', () => {
    const events = [{ type: 'turn/start' }, answered({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 400 }), answered({ inputTokens: 50, outputTokens: 5 }), answered(), { type: 'turn/end' }]
    expect(tokensOf(events)).toEqual({ input: 150, cached: 400, output: 25 })
    expect(tokensOf([])).toEqual({ input: 0, cached: 0, output: 0 })
  })
})

describe('the record of what each turn used', () => {
  it('adds the game master\'s tokens and each helper run to the turn, oldest turn first', () => {
    const s = store()
    addUsage(s, 2, 'helper', { input: 10, cached: 0, output: 4 })
    addUsage(s, 1, 'master', { input: 30, cached: 5, output: 9 })
    addUsage(s, 2, 'helper', { input: 6, cached: 3, output: 1 })
    addUsage(s, 2, 'master', { input: 1, cached: 1, output: 1 })
    expect(readUsage(s)).toEqual([
      { turn: 1, master: { input: 30, cached: 5, output: 9 }, helpers: { input: 0, cached: 0, output: 0 }, runs: 0 },
      { turn: 2, master: { input: 1, cached: 1, output: 1 }, helpers: { input: 16, cached: 3, output: 5 }, runs: 2 },
    ])
  })

  it('ignores a record that is not one', () => {
    const s = store()
    s.metadata.setValue('usage', [{ turn: 'x' }, null, { turn: 1, runs: 0, master: { input: 1, cached: 0, output: 0 }, helpers: { input: 0, cached: 0, output: 0 } }])
    expect(readUsage(s)).toHaveLength(1)
  })
})
