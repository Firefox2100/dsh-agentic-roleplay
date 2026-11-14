import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The answer the host gives, as a fetch stand-in that counts its calls. */
function answer(body: unknown, init: { ok?: boolean; status?: number } = {}): { calls: () => number; fetch: typeof fetch } {
  let calls = 0
  const handler: typeof fetch = (async () => {
    calls += 1
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { calls: () => calls, fetch: handler }
}

function failing(): { calls: () => number; fetch: typeof fetch } {
  let calls = 0
  const handler: typeof fetch = (async () => {
    calls += 1
    throw new Error('the host is not there')
  }) as unknown as typeof fetch
  return { calls: () => calls, fetch: handler }
}

/** The answer is kept for a while, so every case loads the module again against its own clock. */
async function load(): Promise<typeof import('../../src/client/media-capabilities.ts')> {
  vi.resetModules()
  return await import('../../src/client/media-capabilities.ts')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { fetch?: unknown }).fetch
})

describe('which media the host can make', () => {
  it('asks the host and reads the two flags as strict booleans', async () => {
    const host = answer({ synthesis: true, images: 'yes' })
    ;(globalThis as { fetch?: unknown }).fetch = host.fetch
    const { mediaCapabilities } = await load()

    await expect(mediaCapabilities()).resolves.toEqual({ synthesis: true, images: false })
    expect(host.calls()).toBe(1)
  })

  it('keeps the answer for a quarter of a minute and asks again after that', async () => {
    const host = answer({ synthesis: true, images: true })
    ;(globalThis as { fetch?: unknown }).fetch = host.fetch
    const { mediaCapabilities } = await load()

    await mediaCapabilities()
    await mediaCapabilities()
    expect(host.calls(), 'a second look inside the window is answered from the first').toBe(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:16Z'))
    await mediaCapabilities()
    expect(host.calls(), 'a look after the window asks the host again').toBe(2)
  })

  it('does not take a host that cannot say to lack the services', async () => {
    const host = answer({}, { ok: false, status: 503 })
    ;(globalThis as { fetch?: unknown }).fetch = host.fetch
    const { mediaCapabilities } = await load()

    await expect(mediaCapabilities()).resolves.toEqual({ synthesis: true, images: true })
  })

  it('does not take a host that is not there to lack the services', async () => {
    ;(globalThis as { fetch?: unknown }).fetch = failing().fetch
    const { mediaCapabilities } = await load()

    await expect(mediaCapabilities()).resolves.toEqual({ synthesis: true, images: true })
  })
})

describe('watching the capabilities over time', () => {
  it('tells what it finds now and again after the window, until it is stopped', async () => {
    const host = answer({ synthesis: true, images: false })
    ;(globalThis as { fetch?: unknown }).fetch = host.fetch
    const { watchMediaCapabilities } = await load()
    const seen: unknown[] = []

    const stop = watchMediaCapabilities(value => { seen.push(value) })
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([{ synthesis: true, images: false }])

    await vi.advanceTimersByTimeAsync(15_000)
    expect(host.calls(), 'the watch asks again after the window').toBe(2)

    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(host.calls(), 'a stopped watch asks nothing more').toBe(2)
  })

  it('says nothing about a look that was still on its way when the watch was stopped', async () => {
    const host = answer({ synthesis: true, images: true })
    ;(globalThis as { fetch?: unknown }).fetch = host.fetch
    const { watchMediaCapabilities } = await load()
    const seen: unknown[] = []

    const stop = watchMediaCapabilities(value => { seen.push(value) })
    stop()
    await vi.advanceTimersByTimeAsync(0)

    expect(seen).toEqual([])
  })
})
