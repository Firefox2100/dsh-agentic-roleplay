import type { ImportChoices, ImportPreview, UpdateStatus } from '../../../shared/import-card.ts'
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

export async function startImport(id: string, choices: ImportChoices, language: string, update?: string): Promise<{ worldId: string; chatSessionId: string; started: boolean; failure?: string }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/start?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...choices, language, ...(update === undefined ? {} : { update }) }) }))
}

export async function importWithoutModel(id: string, choices: ImportChoices, language: string): Promise<{ worldId: string; draft: boolean }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/structure?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...choices, language }) }))
}

export async function discardImport(id: string): Promise<void> {
  await fetch(`${API_PREFIX}/worlds/import?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
}


/** Whether a world can be updated from a newer card, and whether its last update can be undone. */
export async function updateStatus(worldId: string): Promise<UpdateStatus> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/update?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin' }))
}

/** Returns a world to what it was before its last card update; the answer says where what it held is kept. */
export async function revertUpdate(worldId: string): Promise<{ keptIn: string }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/update?id=${encodeURIComponent(worldId)}`, { method: 'DELETE', credentials: 'same-origin' }))
}

export interface DraftStatus {
  draft: boolean
  check?: { ok: boolean; problems: { where: string; message: string }[]; more: number }
}

/** Whether a world is a draft (an import written but not yet able to start), and what is wrong with it. */
export async function draftStatus(worldId: string, signal?: AbortSignal): Promise<DraftStatus> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/draft?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
}

/** What the person decides about a draft: have the assistant try again, keep it as it is, or discard it. */
export async function decideDraft(worldId: string, action: 'ask' | 'keep' | 'discard', language: string): Promise<{ action: string; started?: { chatSessionId: string; started: boolean; failure?: string } }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/import/draft?id=${encodeURIComponent(worldId)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, language }) }))
}
