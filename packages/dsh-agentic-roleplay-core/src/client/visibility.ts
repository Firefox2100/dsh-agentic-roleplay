/**
 * Whether the page is on screen. A hidden tab keeps its timers but needs no answers, and a missing document (a test,
 * a prerender) counts as visible.
 *
 * `document` is read off `globalThis` rather than named directly: client test files are type-checked by the host
 * tsconfig too, which has no DOM library.
 */
export function pageVisible(): boolean {
  const page = (globalThis as { document?: { visibilityState?: string } }).document
  return page?.visibilityState !== 'hidden'
}

interface VisibilityTarget {
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

/**
 * Calls `wake` when the page comes back on screen, so a view that skipped its reads while hidden can catch up at
 * once instead of waiting for its next timer. A missing document (a test, a prerender) never fires.
 *
 * @returns the disposer that removes the listener.
 */
export function onPageVisible(wake: () => void): () => void {
  const page = (globalThis as { document?: VisibilityTarget }).document
  if (page?.addEventListener === undefined || page.removeEventListener === undefined) return () => undefined
  const listener = (): void => {
    if (pageVisible()) wake()
  }
  page.addEventListener('visibilitychange', listener)
  return () => {
    page.removeEventListener?.('visibilitychange', listener)
  }
}
