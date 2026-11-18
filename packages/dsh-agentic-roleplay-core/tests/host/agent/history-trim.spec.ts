import { createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { MIN_TRIM_CHARS, trimOldResults } from '../../../src/host/agent/history-trim.ts'

/** A session of turns that each ask once and call one tool, whose result is `size` characters long. */
function story(sizes: readonly number[]): { session: Session; texts: () => string[] } {
  const session = Session.create(SessionId('trim-test'))
  session.append('system/message', { turn: 1, step: 1, message: createMessage({ role: 'system', content: [{ type: 'text', text: 'persona' }], source: { kind: 'system-prompt' } }) } as never, { surfaceOp: 'append' })
  sizes.forEach((size, index) => {
    const turn = index + 1
    const callId = ToolCallId(`call-${turn}`)
    session.append('turn/start', { turn })
    session.append('user/message', createMessage({ role: 'user', content: [{ type: 'text', text: `ask ${turn}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('assistant/message', { stream: [], turn, step: 1, message: createMessage({ role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'get_character', arguments: '{}' }], source: { kind: 'model', provider: 'p', model: 'm' } }) } as never, { surfaceOp: 'append' })
    const call = session.append('tool/call', { turn, step: 1, callId, name: 'get_character', arguments: '{}' })
    session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'x'.repeat(size) }], isError: false }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  })
  const texts = (): string[] => [...session.surface.nodes].map(seq => session.eventAt(seq)).filter(event => event?.type === 'tool/result').map(event => (session.deriveEventMessage(event!) as unknown as { content: { text: string }[] }).content[0]!.text)
  return { session, texts }
}

describe('trimming the results of earlier turns', () => {
  it('leaves a short note in place of a large result of an older turn and keeps the recent turns whole', () => {
    const { session, texts } = story([5000, 5000, 5000])
    const done = trimOldResults(session, 3, 2)
    expect(done).toEqual({ count: 1, chars: 5000 })
    const [first, second, third] = texts()
    expect(first).toContain('The result of get_character was left out')
    expect(first).toContain('5000 characters')
    expect(second).toHaveLength(5000)
    expect(third).toHaveLength(5000)
  })

  it('takes one more turn at the start of each turn, and nothing it already changed', () => {
    const { session } = story([5000, 5000, 5000])
    expect(trimOldResults(session, 3, 2).count).toBe(1)
    expect(trimOldResults(session, 3, 2).count).toBe(0)
    expect(trimOldResults(session, 4, 2).count).toBe(1)
  })

  it('keeps everything when asked to, and results too small to be worth a change', () => {
    const kept = story([5000, 5000])
    expect(trimOldResults(kept.session, 5, 0)).toEqual({ count: 0, chars: 0 })
    expect(kept.texts().every(text => text.length === 5000)).toBe(true)
    const small = story([MIN_TRIM_CHARS - 1, 5000])
    expect(trimOldResults(small.session, 5, 1).count).toBe(1)
    expect(small.texts()[0]).toHaveLength(MIN_TRIM_CHARS - 1)
  })

  it('keeps the original in the log, so that the replacement can be traced to it', () => {
    const { session } = story([5000, 5000])
    trimOldResults(session, 3, 2, () => 1234)
    const events = session.snapshotEvents()
    const replacement = events.filter(event => event.type === 'tool/result').at(-1)! as unknown as { data: { message: { content: { text: string }[] } } }
    expect(events.some(event => event.type === 'compaction/prune')).toBe(true)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(3)
    expect(replacement.data.message.content[0]!.text).toContain('left out')
    expect((events.find(event => event.type === 'tool/result')! as unknown as { data: { message: { content: { text: string }[] } } }).data.message.content[0]!.text).toHaveLength(5000)
  })
})
