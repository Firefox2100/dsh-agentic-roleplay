import { useEffect, useState } from 'react'
import type { InterfacePayload, PlayerView } from '../../shared/interface-pack.ts'
import { packOf, viewOf } from './api.ts'

const PACK_POLL_MS = 4000
const VIEW_POLL_MS = 2000

interface Shared<T> {
  listeners: Set<(value: T | undefined) => void>
  value: T | undefined
  stop: () => void
}

/**
 * One poll of the host for everyone who wants the same thing: the strips, the tab and the backdrop of a story all
 * read the same pack and view, so they share the request instead of each making their own.
 */
function useShared<T>(cache: Map<string, Shared<T>>, key: string | undefined, active: boolean, fetch: (previous: T | undefined) => Promise<T>, onError: (error: unknown) => T | undefined, interval: number): T | undefined {
  const [value, setValue] = useState<T | undefined>(key === undefined ? undefined : cache.get(key)?.value)
  useEffect(() => {
    if (key === undefined || !active) { setValue(undefined); return undefined }
    let entry = cache.get(key)
    if (entry === undefined) {
      const created: Shared<T> = { listeners: new Set(), value: undefined, stop: () => undefined }
      entry = created
      cache.set(key, created)
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const look = (): void => {
        fetch(created.value).then((next) => { created.value = next }, (error: unknown) => { created.value = onError(error) }).finally(() => {
          if (stopped) return
          for (const listener of created.listeners) listener(created.value)
          timer = setTimeout(look, interval)
        })
      }
      created.stop = () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
      look()
    }
    const listener = (next: T | undefined): void => { setValue(previous => (previous === next ? previous : next)) }
    entry.listeners.add(listener)
    setValue(entry.value)
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) { entry.stop(); cache.delete(key) }
    }
  }, [cache, key, active, interval])
  return value
}

const packs = new Map<string, Shared<InterfacePayload>>()
const views = new Map<string, Shared<PlayerView>>()

/** The interface pack of a story, looked at again from time to time so that an edited file shows. A session the host does not know has none. */
export function usePack(session: string | undefined): InterfacePayload | undefined {
  return useShared(packs, session, true, async (previous) => {
    const found = await packOf(session as string)
    return previous !== undefined && JSON.stringify(previous) === JSON.stringify(found) ? previous : found
  }, () => ({ pack: null, problems: [] }), PACK_POLL_MS)
}

/** What the player may know of the story, kept up to date while `active`. */
export function usePlayerView(session: string | undefined, active: boolean): PlayerView | undefined {
  return useShared(views, session, active, async (previous) => {
    const reply = await viewOf(session as string, previous?.revision)
    return reply.unchanged !== true && 'view' in reply ? reply.view : previous as PlayerView
  }, (error) => { console.warn('roleplay: the story could not be read for the interface pack', error); return undefined }, VIEW_POLL_MS)
}
