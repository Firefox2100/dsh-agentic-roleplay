import { describe, expect, it } from 'vitest'
import { masterTrace } from '../../../src/host/diagnostics/master-trace.ts'
import { readTraces, updateTrace } from '../../../src/host/sessions/trace.ts'
import { MAX_TRACES, MAX_TRACE_NOTE } from '../../../src/shared/trace.ts'

const call = (time: number, callId: string, name: string) => ({ type: 'tool/call', time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } })
const result = (time: number, callId: string, text: string, isError: boolean) => ({ type: 'tool/result', time, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError } } })
const answer = (time: number) => ({ type: 'assistant/message', time, data: { turn: 1, step: 1, stream: [] } })
const notice = (time: number, text: string) => ({ type: 'user/message', time, data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'roleplay' } } })

describe('the game master\'s trace of a turn', () => {
  const events = [
    { type: 'turn/start', time: 1000, data: { turn: 1 } },
    notice(1100, 'The scene.'),
    { type: 'step/start', time: 4000, data: { turn: 1, step: 1 } },
    answer(5000),
    call(5001, 'a', 'activate_characters'),
    result(20_001, 'a', 'Everyone answered.', false),
    call(20_002, 'b', 'narrate'),
    result(20_003, 'b', `The narration repeats a line twice. ${'x'.repeat(500)}`, true),
    notice(20_004, 'You may not end the turn yet: the output has not been delivered.'),
    { type: 'turn/end', time: 30_000, data: { turn: 1 } },
  ]

  it('says how long the game master waited before its first request, and what each call took and how it ended', () => {
    const trace = masterTrace(events)
    expect(trace).toMatchObject({ startedAt: 1000, endedAt: 30_000, beforeMs: 3000 })
    expect(trace.calls).toEqual([
      { tool: 'activate_characters', ms: 15_000, failed: false, note: 'Everyone answered.' },
      { tool: 'narrate', ms: 1, failed: true, note: expect.stringMatching(/^The narration repeats a line twice\./) },
    ])
    expect(trace.calls?.[1]?.note.length).toBeLessThanOrEqual(MAX_TRACE_NOTE + 1)
  })

  it('lists what the harness said to keep the turn going, but not the notice that opened it', () => {
    expect(masterTrace(events).steered).toEqual(['You may not end the turn yet: the output has not been delivered.'])
  })
})

describe('the traces a story keeps', () => {
  const store = () => {
    const values = new Map<string, unknown>()
    return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } }
  }

  it('gather what the sources of a turn know as they arrive, and add to a list with merge', () => {
    const session = store()
    updateTrace(session, 3, { scene: [{ id: 'scene', tokens: 40 }] })
    updateTrace(session, 3, {}, current => ({ access: [...(current.access ?? []), { character: 'A' } as never] }))
    updateTrace(session, 3, {}, current => ({ access: [...(current.access ?? []), { character: 'B' } as never] }))
    updateTrace(session, 3, { startedAt: 7, endedAt: 9 })
    expect(readTraces(session)).toEqual([expect.objectContaining({ turn: 3, startedAt: 7, endedAt: 9, scene: [{ id: 'scene', tokens: 40 }], access: [{ character: 'A' }, { character: 'B' }] })])
  })

  it('keep the latest turns only, in order', () => {
    const session = store()
    for (let turn = MAX_TRACES + 5; turn >= 1; turn -= 1) updateTrace(session, turn, { startedAt: turn })
    const turns = readTraces(session).map(trace => trace.turn)
    expect(turns).toHaveLength(MAX_TRACES)
    expect(turns.at(-1)).toBe(MAX_TRACES + 5)
    expect(turns).toEqual([...turns].sort((a, b) => a - b))
  })
})
