import { useSyncExternalStore } from 'react'

const KEY = 'roleplay.dock.folded'

/** The browser's storage, which is missing where there is no page and may refuse in a private window. */
const storage = (): Storage | undefined => (globalThis as { localStorage?: Storage }).localStorage

/** Whether the person has folded the story tools away, as this browser last said. */
export function readFolded(): boolean {
  try { return storage()?.getItem(KEY) === '1' } catch { return false }
}

function writeFolded(folded: boolean): void {
  try { storage()?.setItem(KEY, folded ? '1' : '0') } catch { /* private window or blocked storage: the choice lasts until the page is closed */ }
}

let folded = readFolded()
const listeners = new Set<() => void>()

/** Tells the docks when the choice changes; the store the hook reads. */
export function subscribeFolded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Flips the choice, keeps it in this browser for every story, and tells the docks. */
export function toggleFolded(): void {
  folded = !folded
  writeFolded(folded)
  for (const listener of listeners) listener()
}

/** Whether the person has folded the story tools (the turn buttons and the suggested replies) away; it is kept in this browser only, for every story. */
export function useDockFolded(): [boolean, () => void] {
  const value = useSyncExternalStore(subscribeFolded, () => folded)
  return [value, toggleFolded]
}
