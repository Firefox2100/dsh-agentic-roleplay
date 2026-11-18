import { describe, expect, it } from 'vitest'
import { cutOff, finishOf, goingRoundInCircles, lastReplyText } from '../../../src/host/agents/cut-off.ts'

type Event = { type: string; data?: unknown }
const agentOf = (...events: Event[]) => ({ session: { snapshotEvents: () => events } }) as never
const reply = (message?: unknown, stream?: unknown): Event => ({ type: 'assistant/message', data: { message, stream } })

describe('how the last reply of a model ended', () => {
  it('says nothing when the model has made none', () => {
    expect(finishOf(agentOf())).toBeUndefined()
    expect(lastReplyText(agentOf())).toBe('')
    expect(finishOf(agentOf({ type: 'user/message' }))).toBeUndefined()
    expect(lastReplyText(agentOf({ type: 'user/message' }))).toBe('')
  })

  it('finds the reason in the stream of the last reply, and nothing when it has none', () => {
    expect(finishOf(agentOf(reply()))).toBeUndefined()
    expect(finishOf(agentOf(reply(undefined, [{ chunk: { type: 'text' } }])))).toBeUndefined()
    expect(finishOf(agentOf(reply(undefined, [{ chunk: { type: 'finish', reason: { kind: 'stop' } } }])))).toBe('stop')
    expect(finishOf(agentOf(reply(), reply(undefined, [{ chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }])))).toBe('max-tokens')
  })

  it('calls a reply that reached the most it may write cut off', () => {
    expect(cutOff(agentOf(reply(undefined, [{ chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }])))).toBe(true)
    expect(cutOff(agentOf(reply(undefined, [{ chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }])))).toBe(false)
    expect(cutOff(agentOf())).toBe(false)
  })

  it('reads the words of the last reply, its thinking and its answer, and nothing of a reply without them', () => {
    const said = reply({ content: [{ type: 'reasoning', text: 'looking' }, { type: 'text', text: 'here' }, { type: 'image' }] })
    expect(lastReplyText(agentOf(said))).toBe('looking\nhere')
    expect(lastReplyText(agentOf(reply({ content: [{ type: 'text', text: 2 }] })))).toBe('')
    expect(lastReplyText(agentOf(reply({})))).toBe('')
    expect(lastReplyText(agentOf(reply()))).toBe('')
  })
})

describe('a reply that was cut off while going round in circles', () => {
  const line = 'I will look at the next card entry now.'

  it('is one that says the same thing over and over', () => {
    expect(goingRoundInCircles(Array.from({ length: 12 }, () => line).join('\n'))).toBe(true)
  })

  it('is not one with too few lines to tell, or with lines that differ', () => {
    expect(goingRoundInCircles(Array.from({ length: 11 }, () => line).join('\n'))).toBe(false)
    expect(goingRoundInCircles(Array.from({ length: 12 }, (_unused, at) => `${line} ${at}`).join('\n'))).toBe(false)
    expect(goingRoundInCircles('short\nlines\nonly')).toBe(false)
  })
})
