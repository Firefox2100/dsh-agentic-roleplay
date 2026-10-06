import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { describe, expect, it } from 'vitest'
import { chatNarration, chatPreview, textOf } from '../../../src/client/transcript/definitions.ts'
import { encodeOutput, encodePreview, type TurnOutput } from '../../../src/shared/narration.ts'

const narration: TurnOutput = {
  repaired: false,
  timelineNode: 'n4',
  segments: [
    { type: 'narration', text: 'The programme hits the bar.' },
    { type: 'utterance', character: 'clara', name: 'Clara', text: 'Did you now?' },
  ],
}

// The definitions are plain data and functions; the engine's own types are looser than a test needs.
const event = (type: string, data: unknown, seq = 7) => ({ type, data, seq }) as never
/** The result of the tool that delivers an output, as it is logged. */
const delivered = (output: TurnOutput, toolCallId = 'c1', seq = 7) => event('tool/result', {
  message: { toolCallId, content: [{ type: 'text', text: `The output has been delivered.\n${encodeOutput(output)}` }] },
}, seq)
const context = (key: string, kind: string, state: unknown) => ({ key, kind, id: key, state, matches: [] }) as never

type Definition = Pick<ConversationNodeDefinition<never>, 'match' | 'buildViewNode'> & { start: (...args: never[]) => unknown }
const match = (definition: Definition, value: unknown) => definition.match(value as never)
const start = (definition: Definition, ctx: unknown, matched: unknown) => definition.start(ctx as never, matched as never, undefined as never)
const view = (definition: Definition, ctx: unknown) => definition.buildViewNode?.(ctx as never)

describe('the Chat node of a turn output', () => {
  it('matches only the result that delivers an output, by the call id', () => {
    expect(match(chatNarration, delivered(narration, 'call-9'))).toEqual({ id: 'call-9', role: 'start' })
    expect(match(chatNarration, event('user/message', { id: 'x', source: { kind: 'user' } }))).toBeNull()
    expect(match(chatNarration, event('tool/result', { message: { toolCallId: 'c2', content: [{ type: 'text', text: 'saved' }] } }))).toBeNull()
  })

  it('carries the segments, and sits at the session level so the Chat does not fold it into the process', () => {
    const state = start(chatNarration, context('k', 'roleplay-narration', undefined), { event: delivered(narration), role: 'start' } as never)
    expect(state).toEqual({ seq: 7, data: { segments: narration.segments, repaired: false, timelineNode: 'n4' } })
    expect(view(chatNarration, context('k', 'roleplay-narration', state))).toEqual({
      key: 'k', kind: 'roleplay-narration', id: 'k', target: 'chat', anchorSeq: 7, location: { kind: 'session' }, visibility: 'visible',
      data: { segments: narration.segments, repaired: false, timelineNode: 'n4' },
    })
    expect(view(chatNarration, context('k', 'roleplay-narration', undefined))).toBeNull()
  })

  it('refuses to start from another event', () => {
    expect(() => start(chatNarration, context('k', 'x', undefined), { event: event('user/message', {}), role: 'start' })).toThrow(/result of the tool/)
  })
})

describe('the Chat node of a preview', () => {
  const shown = (text: string, toolCallId = 'p1', seq = 5) => event('tool/result', {
    message: { toolCallId, content: [{ type: 'text', text: `${encodePreview(text)}\nShown to the player.` }] },
  }, seq)

  it('matches only the result of the tool that shows one, and never the delivered output', () => {
    expect(match(chatPreview, shown('Air goes still.', 'call-1'))).toEqual({ id: 'call-1', role: 'start' })
    expect(match(chatPreview, delivered(narration))).toBeNull()
    expect(match(chatNarration, shown('Air goes still.'))).toBeNull()
  })

  it('carries the text at the session level, so that the Chat leaves it in the transcript', () => {
    const state = start(chatPreview, context('k', 'roleplay-preview', undefined), { event: shown('Air goes still.'), role: 'start' } as never)
    expect(state).toEqual({ seq: 5, data: { text: 'Air goes still.' } })
    expect(view(chatPreview, context('k', 'roleplay-preview', state))).toEqual({
      key: 'k', kind: 'roleplay-preview', id: 'k', target: 'chat', anchorSeq: 5, location: { kind: 'session' }, visibility: 'visible', data: { text: 'Air goes still.' },
    })
  })
})

describe('textOf', () => {
  it('joins the text blocks and ignores the rest', () => {
    expect(textOf([{ type: 'text', text: ' one ' }, { type: 'image' }, { type: 'text', text: 'two' }])).toBe('one \ntwo')
    expect(textOf([])).toBe('')
  })
})
