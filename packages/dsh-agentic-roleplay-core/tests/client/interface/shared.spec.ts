import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shared, pruneCache, type Shared } from '../../../src/client/interface/shared.ts'
import { clearPage, fakePage, show, withPage } from '../../support/page.ts'

const INTERVAL = 5_000

interface Reading {
  value: number
}

let reads: number

function reader(): (previous: Reading | undefined) => Promise<Reading> {
  return async (previous) => {
    reads += 1
    return { value: (previous?.value ?? 0) + 1 }
  }
}

function cacheOf(): Map<string, Shared<Reading>> {
  return new Map()
}

beforeEach(() => { reads = 0; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); clearPage() })

describe('shared', () => {
  it('gives everyone who asks for the same key the same entry', () => {
    const cache = cacheOf()
    expect(shared(cache, 'a', reader(), () => undefined, INTERVAL)).toBe(shared(cache, 'a', reader(), () => undefined, INTERVAL))
  })

  it('does not read while nobody is listening, and stops reading once the last listener leaves', async () => {
    const cache = cacheOf()
    const entry = shared(cache, 'a', reader(), () => undefined, INTERVAL)
    entry.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(reads).toBe(0)

    const seen: (Reading | undefined)[] = []
    entry.listeners.add((value) => { seen.push(value) })
    entry.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toBe(1)
    expect(seen).toEqual([{ value: 1 }])

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(reads).toBe(2)
    expect(seen.at(-1)).toEqual({ value: 2 })

    entry.listeners.clear()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(reads).toBe(2)
  })

  it('keeps the last value when a listener goes away, so a dock that comes back shows it at once', async () => {
    const entry = shared(cacheOf(), 'a', reader(), () => undefined, INTERVAL)
    const first = vi.fn()
    entry.listeners.add(first)
    entry.refresh()
    await vi.advanceTimersByTimeAsync(0)
    entry.listeners.delete(first)
    expect(entry.value).toEqual({ value: 1 })

    const second = vi.fn()
    entry.listeners.add(second)
    await vi.advanceTimersByTimeAsync(0)
    expect(second).not.toHaveBeenCalled()
    expect(entry.value).toEqual({ value: 1 })
  })

  it('waits while the page is hidden, and reads at once when it comes back', async () => {
    const page = withPage(fakePage('hidden'))
    const entry = shared(cacheOf(), 'a', reader(), () => undefined, INTERVAL)
    const seen = vi.fn()
    entry.listeners.add(seen)
    entry.start()
    entry.refresh()
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(reads).toBe(0)

    page.visibilityState = 'visible'
    show(page)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toBe(1)
    expect(seen).toHaveBeenLastCalledWith({ value: 1 })
  })

  it('stops watching the page when it is stopped, and starts only once', () => {
    const page = withPage(fakePage('visible'))
    const entry = shared(cacheOf(), 'a', reader(), () => undefined, INTERVAL)
    entry.start()
    entry.start()
    expect(page.listeners.size).toBe(1)
    entry.stop()
    expect(page.listeners.size).toBe(0)
    entry.start()
    expect(page.listeners.size).toBe(1)
  })

  it('keeps one tick pending when a refresh lands while a read is still in flight', async () => {
    const release: (() => void)[] = []
    const fetch = (previous: Reading | undefined): Promise<Reading> => new Promise((resolve) => {
      reads += 1
      release.push(() => { resolve({ value: (previous?.value ?? 0) + 1 }) })
    })
    const entry = shared(cacheOf(), 'a', fetch, () => undefined, INTERVAL)
    entry.listeners.add(vi.fn())
    entry.refresh()
    entry.refresh()
    expect(reads).toBe(2)

    for (const done of release) done()
    await vi.advanceTimersByTimeAsync(0)
    // Both reads come back and each would schedule a tick of its own; the next read is still waiting to be answered.
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(reads).toBe(3)
  })

  it('hands a failed read to onError, tells the listeners, and goes on reading', async () => {
    const cache = cacheOf()
    let failing = true
    const fetch = async (): Promise<Reading> => {
      reads += 1
      if (failing) throw new Error('the host is away')
      return { value: 7 }
    }
    const onError = (error: unknown): Reading | undefined => { expect(error).toBeInstanceOf(Error); return undefined }
    const entry = shared(cache, 'a', fetch, onError, INTERVAL)
    const seen: (Reading | undefined)[] = []
    entry.listeners.add((value) => { seen.push(value) })
    entry.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([undefined])

    failing = false
    clearPage()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(seen.at(-1)).toEqual({ value: 7 })
  })
})

describe('pruneCache', () => {
  function entryOf(cache: Map<string, Shared<Reading>>, key: string): Shared<Reading> {
    return shared(cache, key, reader(), () => undefined, INTERVAL)
  }

  it('lets go of the stories nobody is listening to, oldest first', () => {
    const cache = cacheOf()
    for (const key of ['a', 'b', 'c', 'd']) entryOf(cache, key)
    pruneCache(cache, 2, 'd')
    expect([...cache.keys()]).toEqual(['c', 'd'])
  })

  it('keeps the story being opened, and the ones someone is listening to', () => {
    const cache = cacheOf()
    for (const key of ['a', 'b', 'c', 'd']) entryOf(cache, key)
    entryOf(cache, 'b').listeners.add(vi.fn())
    pruneCache(cache, 2, 'd')
    // `a` goes first; `b` has a listener, so the next idle entry (`c`) goes before it.
    expect([...cache.keys()]).toEqual(['b', 'd'])
    pruneCache(cache, 1, 'd')
    expect([...cache.keys()]).toEqual(['b', 'd'])
  })

  it('does nothing while the cache is within its bound', () => {
    const cache = cacheOf()
    entryOf(cache, 'a')
    pruneCache(cache, 8, 'a')
    expect([...cache.keys()]).toEqual(['a'])
  })
})
