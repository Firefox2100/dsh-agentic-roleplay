import { describe, expect, it } from 'vitest'
import { runChild } from '../../../src/host/agents/child.ts'
import { TurnTraces, tracerOf, type SpanHandle, type SpanStart, type Tracer } from '../../../src/host/observability/trace.ts'

interface Started { start: SpanStart; ended?: unknown; updates: unknown[] }

/** A tracer that keeps what it is told. */
function recorder() {
  const spans: Started[] = []
  const links = new Map<string, { traceId: string; spanId: string }>()
  const tracer: Tracer = {
    async run(start, work) {
      const span = tracer.start(start)
      try {
        return await tracer.within(span.ref, () => work(span))
      } finally {
        span.end()
      }
    },
    start(start) {
      const record: Started = { start, updates: [] }
      spans.push(record)
      const handle: SpanHandle = { ref: { traceId: `t${spans.length}`, spanId: `s${spans.length}` }, update: result => record.updates.push(result), end: (result) => { record.ended = result ?? {} } }
      return handle
    },
    within: (_span, work) => work(),
    link: (key, span) => { links.set(key, span); return () => { links.delete(key) } },
    linked: key => (key === undefined ? undefined : links.get(key)),
    current: () => undefined,
    score: () => undefined,
  }
  return { tracer, spans, links }
}

describe('looking the tracer up', () => {
  it('finds it only when the providers plugin offers one', () => {
    const { tracer } = recorder()
    expect(tracerOf({ get: () => tracer })).toBe(tracer)
    expect(tracerOf({ get: () => undefined })).toBeUndefined()
    expect(tracerOf({ get: () => ({ startActivation: () => undefined }) })).toBeUndefined()
  })
})

describe('the trace of a turn', () => {
  const chat = 'session-5b9a4c2e-7a3c-4a25-9f5e-0f3a8b0a1c11'

  it('opens when the game master starts, is where the chat\'s work nests, and ends with the turn', () => {
    const { tracer, spans, links } = recorder()
    const turns = new TurnTraces(() => tracer)
    turns.begin(chat, 3, 'I open the door.')
    expect(spans[0]!.start).toMatchObject({ name: 'turn 3', input: 'I open the door.', trace: { name: 'turn 3', sessionId: '5b9a4c2e-7a3c-4a25-9f5e-0f3a8b0a1c11', tags: ['roleplay'] } })
    expect(links.get(chat)).toEqual(turns.of(chat))
    turns.end(chat)
    expect(spans[0]!.ended).toEqual({})
    expect(links.size).toBe(0)
    expect(turns.of(chat)).toBeUndefined()
  })

  it('takes what the player was shown as the output of the turn, and files a round under it', () => {
    const { tracer, spans } = recorder()
    const turns = new TurnTraces(() => tracer)
    expect(turns.child(chat, { name: 'round' })).toBeUndefined()
    turns.begin(chat, 2, 'I knock.')
    const round = turns.child(chat, { name: 'round', input: { characters: ['ann'] } })
    expect(spans[1]!.start.parent).toEqual(turns.of(chat))
    round?.end({ output: 'done' })
    turns.output(chat, 'The door opens.')
    turns.end(chat)
    expect(spans[0]!.ended).toEqual({ output: 'The door opens.' })
    expect(spans[1]!.ended).toEqual({ output: 'done' })
  })

  it('closes a turn that never ended when the next begins, and does nothing without a tracer', () => {
    const { tracer, spans } = recorder()
    const turns = new TurnTraces(() => tracer)
    turns.begin(chat, 1, 'a')
    turns.begin(chat, 2, 'b')
    expect(spans[0]!.ended).toBeDefined()
    expect(spans).toHaveLength(2)
    expect(() => { new TurnTraces(() => undefined).begin(chat, 1, 'a') }).not.toThrow()
  })
})

describe('a helper run', () => {
  const chat = 'session-5b9a4c2e-7a3c-4a25-9f5e-0f3a8b0a1c11'

  it('is a span under the turn of its chat, linked by its own session id while it runs, and records how it ended', async () => {
    const { tracer, spans, links } = recorder()
    const turn = tracer.start({ name: 'turn 1' })
    links.set(chat, turn.ref)
    let seenLink: unknown
    const parent = {
      session: { id: chat, snapshotEvents: () => [] },
      ctx: { get: (name: string) => name === 'aiTrace' ? tracer : { startActivation: ({ childId }: { childId: string }) => { seenLink = links.get(childId); return Promise.reject(new Error('the agent could not start')) } } },
    }
    await expect(runChild({ parent: parent as never, signal: new AbortController().signal, persona: 'You are Tomas.\nMore rules.', prompt: 'Say hello', result: { type: 'object', properties: {} } as never })).rejects.toThrow('could not start')
    const helper = spans[1]!
    expect(helper.start).toMatchObject({ name: 'You are Tomas.', kind: 'agent', input: 'Say hello', parent: turn.ref })
    expect(seenLink).toEqual({ traceId: 't2', spanId: 's2' })
    expect(helper.updates[0]).toMatchObject({ level: 'ERROR', statusMessage: 'the agent could not start' })
    expect(helper.ended).toBeDefined()
    expect([...links.keys()]).toEqual([chat])
  })

  it('starts a trace of its own, under the story, when no turn is around it', async () => {
    const { tracer, spans } = recorder()
    const parent = { session: { id: chat, snapshotEvents: () => [] }, ctx: { get: (name: string) => name === 'aiTrace' ? tracer : { startActivation: () => Promise.reject(new Error('x')) } } }
    await runChild({ parent: parent as never, signal: new AbortController().signal, persona: 'You keep the records.', prompt: 'p', result: { type: 'object', properties: {} } as never }).catch(() => undefined)
    expect(spans[0]!.start).toMatchObject({ trace: { sessionId: '5b9a4c2e-7a3c-4a25-9f5e-0f3a8b0a1c11', tags: ['roleplay'] } })
  })
})
