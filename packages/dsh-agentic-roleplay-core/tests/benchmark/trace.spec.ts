import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveContext, liveStructured, newCounters, type LiveOptions } from './live.ts'
import { replayContext, replayStructured } from './replay.ts'
import { Trace, auditTrace, jobKey, readTrace } from './trace.ts'
import { VARIABLE_CASES } from './variable-cases.ts'
import { runVariableCase } from './variables-harness.ts'

/**
 * The trace of a live run, on a model that is a stub: what is written is whole and complete, secrets are not in it, and a run can be answered again from it without a model.
 * A live run that fails is then on disk the first time it fails, and can be scored again, or the code changed under it, with the model it had.
 */
let folder: string
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'bench-trace-')) })
afterEach(() => { vi.unstubAllGlobals(); rmSync(folder, { recursive: true, force: true }) })

const options: LiveOptions = { llm: { url: 'http://model.test/v1', model: 'stub', temperature: 0.2, reasoning: 'none', apiKey: 'SECRET-KEY' }, concurrency: 1 }

/** A model that calls `submit_result` with the answer a script gives, and that records what it was sent. */
function stubModel(answer: (body: { messages: { role: string; content: string }[] }) => unknown): { sent: unknown[] } {
  const sent: unknown[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[]; response_format?: unknown }
    sent.push(body)
    const value = answer(body)
    const message = body.response_format === undefined
      ? { content: null, tool_calls: [{ id: 'c1', function: { name: 'submit_result', arguments: JSON.stringify(value) } }] }
      : { content: JSON.stringify(value) }
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 }))
  }))
  return { sent }
}

describe('the trace of a run', () => {
  it('writes the request whole, the raw answer, the accepted result and the state, and never the key', async () => {
    stubModel(() => ({ same: true }))
    const trace = Trace.open(folder, 'case one', { id: 'case', label: 'test', language: 'en', run: 1 })
    const ctx = liveContext(options, 'en', newCounters(trace))
    const schema = { type: 'object', properties: { same: { type: 'boolean' } }, required: ['same'] }
    expect(await ctx.run({ persona: 'Judge.', prompt: 'Are they the same?', result: schema } as never)).toEqual({ same: true })
    trace.state('world', { files: ['a.json'] })
    trace.expect('same found', true)
    const text = readFileSync(trace.file!, 'utf8')
    const events = readTrace(text)
    expect(events.map(event => event.kind)).toEqual(['header', 'job', 'request', 'response', 'result', 'state', 'expect'])
    expect(events[2]).toMatchObject({ service: 'llm', url: 'http://model.test/v1/chat/completions', body: { model: 'stub', messages: [{ role: 'system', content: 'Judge.' }, { role: 'user', content: 'Are they the same?' }] } })
    expect(events[3]).toMatchObject({ status: 200, raw: { usage: { prompt_tokens: 7 } } })
    expect(text).not.toContain('SECRET-KEY')
    expect(auditTrace(events)).toEqual([])
  })

  it('records an answer the job refused, with the reason, and the failure when it is refused every time', async () => {
    stubModel(() => ({ same: 'maybe' }))
    const trace = Trace.open(folder, 'refused', { id: 'case', label: 'test' })
    const counters = newCounters(trace)
    await expect(liveContext(options, 'en', counters).run({ persona: 'p', prompt: 'q', result: {}, check: () => 'say yes or no' } as never)).rejects.toThrow(/refused 3 times/)
    const events = readTrace(readFileSync(trace.file!, 'utf8'))
    expect(events.filter(event => event.kind === 'refusal').map(event => event['problem'])).toEqual(['say yes or no', 'say yes or no', 'say yes or no'])
    expect(events.at(-1)).toMatchObject({ kind: 'error', service: 'job' })
    expect(auditTrace(events)).toEqual([])
    expect(counters.failures).toHaveLength(1)
  })

  it('notices a trace that cannot be trusted: no header, a request nobody answered', () => {
    expect(auditTrace([{ t: 0, kind: 'request' }])).toEqual(['the trace does not begin with its header', '1 requests but 0 answers or errors'])
  })

  it('writes nothing when tracing is off', async () => {
    stubModel(() => ({ ok: true }))
    const counters = newCounters()
    await liveContext(options, 'en', counters).run({ persona: 'p', prompt: 'q', result: {} } as never)
    expect(Trace.off.file).toBeUndefined()
  })
})

describe('answering a run again from its trace', () => {
  it('gives a job the answer it got, in order when it was asked twice, and fails a job it never saw', async () => {
    let asked = 0
    stubModel(() => ({ n: ++asked }))
    const trace = Trace.open(folder, 'twice', { id: 'case', label: 'test' })
    const live = liveContext(options, 'en', newCounters(trace))
    await live.run({ persona: 'p', prompt: 'q', result: {} } as never)
    await live.run({ persona: 'p', prompt: 'q', result: {} } as never)
    const events = readTrace(readFileSync(trace.file!, 'utf8'))
    const replay = replayContext(events, 'en')
    expect(await replay.run({ persona: 'p', prompt: 'q', result: {} } as never)).toEqual({ n: 1 })
    expect(await replay.run({ persona: 'p', prompt: 'q', result: {} } as never)).toEqual({ n: 2 })
    await expect(Promise.resolve().then(() => replay.run({ persona: 'p', prompt: 'other', result: {} } as never))).rejects.toThrow(/no answer for the job/)
    expect(jobKey('p', 'q', {})).toBe(jobKey('p', 'q', {}))
  })

  it('scores a tracked-value case again from its trace to the same verdicts as the run that was recorded', async () => {
    const benchmark = VARIABLE_CASES[0]!
    // a stub that says nothing changed: the case's verdicts are then fixed by the harness and the recorded answers alone
    stubModel(body => Object.fromEntries(Object.keys((body as unknown as { response_format: { json_schema: { schema: { properties: Record<string, unknown> } } } }).response_format.json_schema.schema.properties).map(key => [key, false])))
    const trace = Trace.open(folder, 'variables', { id: benchmark.id, label: 'test', language: 'en' })
    const recorded = await runVariableCase(benchmark, 'en', { mode: 'llm', trace, ask: liveStructured(options, newCounters(trace)) })
    const events = readTrace(readFileSync(trace.file!, 'utf8'))
    expect(events.filter(event => event.kind === 'expect').length).toBe(recorded.items.length)
    expect(auditTrace(events)).toEqual([])
    vi.unstubAllGlobals()
    const again = await runVariableCase(benchmark, 'en', { mode: 'llm', ask: replayStructured(events) })
    const verdicts = (result: typeof recorded) => ({ items: result.items, tp: result.tp, fn: result.fn, fp: result.fp, tolerated: result.tolerated, valueWrong: result.valueWrong, problems: result.problems })
    expect(verdicts(again)).toEqual(verdicts(recorded))
  })
})
