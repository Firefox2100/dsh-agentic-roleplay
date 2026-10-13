import type { StarterWorld } from '../../../shared/starter.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

/** The worlds that ship with the plugin. */
export async function loadStarters(signal: AbortSignal): Promise<StarterWorld[]> {
  return await answer(await fetch(`${API_PREFIX}/worlds/starter`, { credentials: 'same-origin', signal }))
}

/** Copies one into the person's worlds. */
export async function addStarter(folder: string): Promise<void> {
  await answer(await fetch(`${API_PREFIX}/worlds/starter`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder }) }))
}
