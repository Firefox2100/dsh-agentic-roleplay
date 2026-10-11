import { AVATARS_WORLD_ID } from '../shared/avatars.ts'
import type { WorldState } from '../shared/world-state.ts'
import { API_PREFIX } from '../shared/worlds.ts'

/** What lists of avatars show of one. */
export interface AvatarSummary {
  key: string
  name: string
  summary: string
  portrait?: string
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
  const problems = Array.isArray(body?.problems) ? body.problems.join('; ') : undefined
  return new Error(problems ?? (typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()))
}

export async function listAvatars(signal: AbortSignal): Promise<AvatarSummary[]> {
  const response = await fetch(`${API_PREFIX}/worlds/state?id=${encodeURIComponent(AVATARS_WORLD_ID)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  const state = await response.json() as WorldState
  return state.characters.map(character => ({ key: character.key, name: character.name, summary: character.summary, ...(character.portrait === undefined ? {} : { portrait: character.portrait }) }))
}

/** @returns the key of the new avatar. */
export async function createAvatar(name: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${API_PREFIX}/avatars`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }), signal })
  if (!response.ok) throw await failure(response)
  return (await response.json() as { key: string }).key
}

export async function deleteAvatar(key: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${API_PREFIX}/avatars?key=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
}

/** @returns the ids the avatars have in the world. */
export async function addAvatarsToWorld(worldId: string, keys: readonly string[], signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API_PREFIX}/worlds/avatars?id=${encodeURIComponent(worldId)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ avatars: keys }), signal })
  if (!response.ok) throw await failure(response)
  return (await response.json() as { added: string[] }).added
}
