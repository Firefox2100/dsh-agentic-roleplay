import { useCallback, useEffect, useState } from 'react'
import type { ReferenceReplies, ReferenceSection } from '../../shared/reference.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { onPageVisible, pageVisible } from '../visibility.ts'
import { loadReference } from './reference-api.ts'

/** How often a page on screen reads again: the story moves with every turn. */
const REFRESH_MS = 8000

export type Reading<K extends ReferenceSection> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; entries: ReferenceReplies[K] }

/** A page's entries, read when it is shown and again while it stays on screen. */
export function useReference<K extends ReferenceSection>(chat: string, section: K, visible: boolean, character?: string): { reading: Reading<K>; refresh: () => void } {
  const session = roleplaySessionOf(chat)
  const identity = `${session ?? ''}\0${section}\0${character ?? ''}`
  const [result, setResult] = useState<{ identity: string; reading: Reading<K> }>({ identity, reading: { state: 'loading' } })
  const reading: Reading<K> = result.identity === identity ? result.reading : { state: 'loading' }
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (session === undefined || !visible) return undefined
    const abort = new AbortController()
    const load = (): void => {
      if (!pageVisible()) return
      loadReference(session, section, abort.signal, character).then(
        (reply) => { setResult({ identity, reading: { state: 'ready', entries: reply.entries } }) },
        (failure: unknown) => { if (!abort.signal.aborted) setResult({ identity, reading: { state: 'failed', message: failure instanceof Error ? failure.message : String(failure) } }) },
      )
    }
    load()
    let timer: number | undefined
    const schedule = (): void => { timer = window.setTimeout(() => { load(); schedule() }, REFRESH_MS) }
    schedule()
    // A hidden page skips its reads but keeps the chain, and reads again the moment it is back on screen.
    const off = onPageVisible(() => { load() })
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      off()
      abort.abort()
    }
  }, [session, section, visible, tick, character])
  const refresh = useCallback(() => { setTick(count => count + 1) }, [])
  return { reading, refresh }
}
