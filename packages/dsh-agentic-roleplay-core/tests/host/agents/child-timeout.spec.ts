import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChildTimeoutError, namedModel, runChild } from '../../../src/host/agents/child.ts'

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
