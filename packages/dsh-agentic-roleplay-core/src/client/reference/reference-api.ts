import type { Journal } from '../../shared/journal.ts'
import type { ReferenceReply, ReferenceSection } from '../../shared/reference.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

/** One page of what the player may look up about the story. */
export async function loadReference<K extends ReferenceSection>(session: string, section: K, signal: AbortSignal, character?: string): Promise<ReferenceReply<K>> {
  const response = await fetch(`${API_PREFIX}/sessions/reference?id=${encodeURIComponent(session)}&section=${section}${character === undefined ? '' : `&character=${encodeURIComponent(character)}`}`, { credentials: 'same-origin', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as ReferenceReply<K>
}

const failed = async (response: Response): Promise<Error> => {
  const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
  return new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
}

/** The player's notes on the story. */
export async function loadJournal(session: string, signal: AbortSignal): Promise<Journal> {
  const response = await fetch(`${API_PREFIX}/sessions/journal?id=${encodeURIComponent(session)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw await failed(response)
  return await response.json() as Journal
}

export async function saveJournal(session: string, text: string, signal?: AbortSignal): Promise<Journal> {
  const response = await fetch(`${API_PREFIX}/sessions/journal?id=${encodeURIComponent(session)}`, { method: 'PUT', credentials: 'same-origin', ...signal === undefined ? {} : { signal }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
  if (!response.ok) throw await failed(response)
  return await response.json() as Journal
}
