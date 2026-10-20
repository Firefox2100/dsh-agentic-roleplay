import type { LorebookEntry, LorebookSummary, LorebookText } from '../shared/lorebooks.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const named = (name: string): string => `name=${encodeURIComponent(name)}`

export async function listLorebooks(signal: AbortSignal): Promise<LorebookSummary[]> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks`, { credentials: 'same-origin', signal }))
}

export async function readLorebook(name: string, signal: AbortSignal): Promise<LorebookText> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/item?${named(name)}`, { credentials: 'same-origin', signal }))
}

export async function createLorebook(request: { name: string; title?: string; description?: string }, signal: AbortSignal): Promise<LorebookSummary> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks`, { ...json('POST', request), signal }))
}

export async function updateLorebookInfo(name: string, change: { title?: string; description?: string }, signal: AbortSignal): Promise<LorebookSummary> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/item?${named(name)}`, { ...json('PUT', change), signal }))
}

export async function writeLorebookEntry(name: string, entry: LorebookEntry, signal: AbortSignal): Promise<LorebookSummary> {
  const { id, ...rest } = entry
  return await reply(await fetch(`${API_PREFIX}/lorebooks/entry?${named(name)}&id=${encodeURIComponent(id)}`, { ...json('PUT', rest), signal }))
}

export async function removeLorebookEntry(name: string, id: string, signal: AbortSignal): Promise<LorebookSummary> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/entry?${named(name)}&id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', signal }))
}

export async function deleteLorebook(name: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${API_PREFIX}/lorebooks/item?${named(name)}`, { method: 'DELETE', credentials: 'same-origin', signal })
  if (!response.ok) await reply(response)
}

/** Opens the authoring chat of a lorebook. */
export async function authorLorebook(name: string, language: string, signal: AbortSignal): Promise<{ chatSessionId: string }> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/authoring?${named(name)}`, { ...json('POST', { language }), signal }))
}

/** Sends a SillyTavern lorebook to a new library lorebook, whose authoring chat turns it into entries. */
export async function importLorebook(name: string, file: File, language: string, signal: AbortSignal): Promise<{ name: string; chatSessionId: string; started: boolean; failure?: string }> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/import?${named(name)}&language=${encodeURIComponent(language)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: file, signal }))
}
