import type { ImportChoices, ImportPreview } from '../../../shared/import-card.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'

export async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
    const problems = Array.isArray(body?.problems) ? body.problems.join('; ') : undefined
    throw new Error(problems ?? (typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()))
  }
  return await response.json() as T
}

/** Sends a card file to the host to be read; the answer is what it holds. */
export async function uploadCard(file: File): Promise<ImportPreview> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/card`, { method: 'POST', credentials: 'same-origin', headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' }, body: file }))
}

export async function startImport(id: string, choices: ImportChoices, language: string): Promise<{ worldId: string; chatSessionId: string; started: boolean; failure?: string }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/start?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...choices, language }) }))
}

export async function discardImport(id: string): Promise<void> {
  await fetch(`${API_PREFIX}/worlds/import?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
}

