import { useEffect, useState } from 'react'
import type { InterfacePayload, PlayerView } from '../../shared/interface-pack.ts'
import { packOf, viewOf } from './api.ts'
import { pruneCache, shared, type Shared } from './shared.ts'

/** A pack is a file an author edits; the view is what the host has of the story now, and a turn ending says when to look. */
const PACK_POLL_MS = 10_000
const VIEW_POLL_MS = 5_000
/** Stories kept in memory after the player leaves them: the last few opened again look right at once. */
const KEPT_SESSIONS = 8

/** The same shared entry as `shared()`, but kept for as long as a component wants it, and looked at once when it arrives or the story moves. */
function useShared<T>(cache: Map<string, Shared<T>>, key: string | undefined, active: boolean, fetch: (previous: T | undefined) => Promise<T>, onError: (error: unknown) => T | undefined, interval: number, revision?: unknown): T | undefined {
  const [value, setValue] = useState<T | undefined>(key === undefined ? undefined : cache.get(key)?.value)
  useEffect(() => {
    if (key === undefined || !active) { setValue(undefined); return undefined }
    const entry = shared(cache, key, fetch, onError, interval)
    pruneCache(cache, KEPT_SESSIONS, key)
    const listener = (next: T | undefined): void => { setValue(previous => (previous === next ? previous : next)) }
    const idle = entry.listeners.size === 0
    entry.listeners.add(listener)
    if (idle) entry.start()
    setValue(entry.value)
    // Coming back to the dock, or a turn ending, is a reason to look now rather than at the next tick.
    if (idle) entry.refresh()
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) entry.stop()
    }
  }, [cache, key, active, interval, revision])
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

/** What the player may know of the story, kept up to date while `active`; `revision` says when the story moved (its turn). */
export function usePlayerView(session: string | undefined, active: boolean, revision?: unknown): PlayerView | undefined {
  return useShared(views, session, active, async (previous) => {
    const reply = await viewOf(session as string, previous?.revision)
    return reply.unchanged !== true && 'view' in reply ? reply.view : previous as PlayerView
  }, (error) => { console.warn('roleplay: the story could not be read for the interface pack', error); return undefined }, VIEW_POLL_MS, revision)
}
