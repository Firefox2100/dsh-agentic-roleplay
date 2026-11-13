import { useSyncExternalStore } from 'react'

const KEY = 'roleplay.dock.folded'

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

let folded = read()
const listeners = new Set<() => void>()

/** Whether the person has folded the story tools (the turn buttons and the suggested replies) away; it is kept in this browser only, for every story. */
export function useDockFolded(): [boolean, () => void] {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => folded)
  return [value, () => {
    folded = !folded
    try { localStorage.setItem(KEY, folded ? '1' : '0') } catch { /* private window or blocked storage: the choice lasts until the page is closed */ }
    for (const listener of listeners) listener()
  }]
}
