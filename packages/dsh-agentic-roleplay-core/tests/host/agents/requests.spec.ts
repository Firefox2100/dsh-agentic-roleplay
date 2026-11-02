import { describe, expect, it } from 'vitest'
import { requestsOf } from '../../../src/host/agents/requests.ts'
import { addUsage, readUsage } from '../../../src/host/sessions/usage.ts'

const step = (turn: number, number: number, time: number) => ({ type: 'step/start', time, data: { turn, step: number } })
const answer = (turn: number, number: number, time: number, first: number, usage: Record<string, number> | undefined, stop = 'tool-calls') => ({
  type: 'assistant/message',
  time,
  data: { turn, step: number, stream: [
    { type: 'chunk', time: first, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    ...(usage === undefined ? [] : [{ type: 'chunk', time: time - 1, chunk: { type: 'usage', usage } }]),
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: stop } } },
  ] },
})

describe('the requests a session recorded', () => {
  it('give the prompt, the wait for the first answer, the whole time and how it stopped', () => {
    const events = [step(1, 1, 1000), answer(1, 1, 4000, 1800, { inputTokens: 300, cacheReadTokens: 2000, outputTokens: 20 }), step(1, 2, 4100), answer(1, 2, 4600, 4300, { inputTokens: 2400, outputTokens: 9 }, 'max-tokens')]
    expect(requestsOf(events)).toEqual([
      { step: 1, prompt: 2300, cached: 2000, output: 20, waitMs: 800, ms: 3000, stop: 'tool-calls', parts: [{ id: 'earlier', tokens: 2300 }] },
      { step: 2, prompt: 2400, output: 9, waitMs: 200, ms: 500, stop: 'max-tokens', parts: [{ id: 'earlier', tokens: 2400 }] },
    ])
  })

  it('leave out what the service did not say, so a missing cache figure is not a zero', () => {
    const [request] = requestsOf([step(1, 1, 0), answer(1, 1, 500, 100, undefined)])
    expect(request).toEqual({ step: 1, waitMs: 100, ms: 500, stop: 'tool-calls' })
    expect(request).not.toHaveProperty('cached')
  })
})

describe('what a prompt was made of', () => {
  const text = (words: number) => 'word '.repeat(words * 4 / 5)
  const message = (kind: string, size: number) => ({ type: 'user/message', time: 1, data: { role: 'user', content: [{ type: 'text', text: text(size) }], source: { kind } } })

  it('splits the log\'s own parts and leaves what the service counted beyond them as the earlier conversation', () => {
    const events = [
      { type: 'turn/start', time: 0, data: { turn: 2 } },
      step(2, 1, 1),
      { type: 'system/message', time: 2, data: { turn: 2, step: 1, message: { role: 'system', content: [{ type: 'text', text: text(100) }] } } },
      { type: 'request/header', time: 2, data: { header: { tools: [{ name: 'narrate', description: text(50) }] } } },
      message('roleplay', 40),
      message('user', 10),
      answer(2, 1, 100, 50, { inputTokens: 1000, outputTokens: 5 }),
      { type: 'tool/result', time: 101, data: { turn: 2, step: 1, message: { role: 'tool', content: [{ type: 'text', text: text(30) }] } } },
      step(2, 2, 102),
      answer(2, 2, 200, 150, { inputTokens: 1100, outputTokens: 5 }),
    ]
    const [first, second] = requestsOf(events)
    const sizes = (parts: { id: string; tokens: number }[] | undefined) => Object.fromEntries((parts ?? []).map(part => [part.id, part.tokens]))
    expect(sizes(first?.parts)).toMatchObject({ system: 100, notices: 40, input: 10 })
    expect(sizes(first?.parts)['tools']).toBeGreaterThan(50)
    expect(sizes(first?.parts)['steps']).toBeUndefined()
    expect(sizes(first?.parts)['earlier']).toBe(1000 - Object.entries(sizes(first?.parts)).filter(([id]) => id !== 'earlier').reduce((sum, [, tokens]) => sum + tokens, 0))
    expect(sizes(second?.parts)['steps']).toBeGreaterThanOrEqual(30)
  })

  it('counts a Chinese character as less than a token and a western word as about a token', () => {
    const [request] = requestsOf([{ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '你好'.repeat(50) }], source: { kind: 'user' } } }, answer(1, 1, 5, 2, undefined)])
    expect(request?.parts).toEqual([{ id: 'input', tokens: 70 }])
  })
})

describe('the game master\'s time in a turn', () => {
  it('is kept beside the tokens', () => {
    const values = new Map<string, unknown>()
    const session = { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } }
    addUsage(session, 1, 'master', { input: 5, cached: 0, output: 2 }, 9000)
    expect(readUsage(session)[0]).toMatchObject({ masterMs: 9000 })
  })
})
