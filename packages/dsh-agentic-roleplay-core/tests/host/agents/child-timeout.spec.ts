import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChildTimeoutError, helpers, namedModel, runChild } from '../../../src/host/agents/child.ts'

/** A parent whose sub-agent never answers until it is cancelled: what a model that thinks without end looks like. */
function endless() {
  const disposed: string[] = []
  const parent = {
    session: { snapshotEvents: () => [] },
    ctx: {
      get: () => ({
        startActivation: ({ signal }: { signal: AbortSignal }) => Promise.resolve({
          result: new Promise((_, reject) => { if (signal.aborted) reject(new Error('aborted')); signal.addEventListener('abort', () => { reject(new Error('aborted')) }) }),
          dispose: () => { disposed.push('done'); return Promise.resolve() },
        }),
      }),
    },
  }
  return { parent: parent as never, disposed }
}

const task = (parent: never, extra: object = {}) => ({ parent, signal: new AbortController().signal, persona: 'p', prompt: 'q', result: { type: 'object', properties: {} } as never, ...extra })

afterEach(() => { vi.useRealTimers() })

describe('a helper that does not finish', () => {
  it('is stopped when its time is up, and the error says why and what to change', async () => {
    vi.useFakeTimers()
    const { parent, disposed } = endless()
    const seen: string[] = []
    const run = runChild({ ...task(parent), timeoutMinutes: 2, trace: (ran) => { seen.push(ran.error ?? '') } })
    const failed = expect(run).rejects.toBeInstanceOf(ChildTimeoutError)
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1)
    await failed
    expect(disposed).toEqual(['done'])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/stopped after 2 minutes.*thinking level/)
  })

  it('is not stopped by a time of 0, and a person cancelling it is a cancellation, not a timeout', async () => {
    const { parent } = endless()
    const abort = new AbortController()
    const run = runChild({ ...task(parent), signal: abort.signal, timeoutMinutes: 5 })
    const failed = expect(run).rejects.toThrow(/cancelled|aborted/)
    abort.abort()
    await failed
    await expect(runChild({ ...task(parent), signal: AbortSignal.abort(), timeoutMinutes: 0 })).rejects.not.toBeInstanceOf(ChildTimeoutError)
  })
})

describe('namedModel', () => {
  it('names the provider and the model, and nothing for an empty name', () => {
    expect(namedModel(' localai/qwen/small ')).toEqual({ model: { provider: 'localai', model: 'qwen/small' } })
    expect(namedModel('  ')).toEqual({})
  })
})

describe('a helper that was stopped', () => {
  it('is not waited for past its grace when its activation never settles, and the caller is told why it was stopped', async () => {
    vi.useFakeTimers()
    let cancelled = 0
    const registered: { execute: (args: unknown, exec: unknown) => unknown }[] = []
    const never = new Promise(() => undefined)
    const parent = {
      session: { snapshotEvents: () => [] },
      ctx: {
        get: () => ({
          startActivation: ({ childId }: { childId: string }) => {
            helpers.get(childId)!.setup({
              session: { snapshotEvents: () => [] },
              cancel: () => { cancelled += 1 },
              steer: () => undefined,
              ctx: { tools: { restrict: () => undefined, register: (tool: never) => { registered.push(tool); return () => undefined }, guard: () => undefined }, on: () => undefined },
            } as never)
            return Promise.resolve({ result: never, dispose: () => never })
          },
        }),
      },
    }
    const run = runChild({ ...task(parent as never), beforeSubmit: () => 'the name is not acceptable' })
    const failed = expect(run).rejects.toThrow(/refused 5 times and the agent was stopped.*not acceptable/)
    await vi.advanceTimersByTimeAsync(10)
    const submit = registered.find(tool => (tool as unknown as { name: string }).name === 'submit_result')!
    for (let attempt = 0; attempt < 5; attempt += 1) try { await submit.execute({}, { concludeTurn: () => undefined }) } catch { /* each refusal is thrown to the model */ }
    expect(cancelled).toBe(1)
    await vi.advanceTimersByTimeAsync(40_000)
    await failed
  })
})
