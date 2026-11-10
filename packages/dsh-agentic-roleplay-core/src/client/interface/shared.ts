import { onPageVisible, pageVisible } from '../visibility.ts'

/** One thing everyone who wants it shares: its last value, who is listening, and when it was last read. */
export interface Shared<T> {
  listeners: Set<(value: T | undefined) => void>
  value: T | undefined
  /** Look at once, without waiting for the next tick. */
  refresh: () => void
  /** Watch for the page coming back, which is a reason to look at once; only while someone is listening. */
  start: () => void
  stop: () => void
}

/**
 * One poll of the host for everyone who wants the same thing: the strips, the tab and the backdrop of a story all
 * read the same pack and view, so they share the request instead of each making their own. The entry outlives the
 * components (its last value is shown again at once when one comes back), and it only polls while someone is
 * listening, on a visible page.
 */
export function shared<T>(cache: Map<string, Shared<T>>, key: string, fetch: (previous: T | undefined) => Promise<T>, onError: (error: unknown) => T | undefined, interval: number): Shared<T> {
  const found = cache.get(key)
  if (found !== undefined) return found
  let timer: ReturnType<typeof setTimeout> | undefined
  let off: (() => void) | undefined
  const created: Shared<T> = {
    listeners: new Set(),
    value: undefined,
    refresh: () => { if (timer !== undefined) clearTimeout(timer); look() },
    start: () => { off ??= onPageVisible(() => { created.refresh() }) },
    stop: () => { off?.(); off = undefined },
  }
  const schedule = (): void => {
    // A refresh while a read is in flight starts a second one; both of them come back here. Only one tick may be
    // pending, or each of them would schedule its own and the polls would double.
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(look, interval)
  }
  const look = (): void => {
    timer = undefined
    if (created.listeners.size === 0) return
    if (!pageVisible()) { schedule(); return }
    fetch(created.value).then((next) => { created.value = next }, (error: unknown) => { created.value = onError(error) }).finally(() => {
      if (created.listeners.size === 0) return
      for (const listener of created.listeners) listener(created.value)
      schedule()
    })
  }
  cache.set(key, created)
  return created
}

/**
 * Let go of stories nobody is looking at: an entry is only a last value, and keeping one for every session ever
 * opened would grow for as long as the page lives. Entries someone is listening to, and the one being opened, stay.
 */
export function pruneCache<T>(cache: Map<string, Shared<T>>, keep: number, keepKey: string): void {
  if (cache.size <= keep) return
  for (const [key, entry] of cache) {
    if (cache.size <= keep) return
    if (key === keepKey || entry.listeners.size > 0) continue
    entry.stop()
    cache.delete(key)
  }
}
