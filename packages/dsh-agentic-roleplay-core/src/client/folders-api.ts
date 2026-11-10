import type { FoldersStatus, StoryFolder } from '../shared/folders.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

export async function loadStoryFolders(session: string, signal: AbortSignal): Promise<FoldersStatus> {
  return await reply(await fetch(`${API_PREFIX}/sessions/folders?id=${encodeURIComponent(session)}`, { credentials: 'same-origin', signal }))
}

export async function saveStoryFolders(session: string, folders: readonly StoryFolder[], signal: AbortSignal): Promise<FoldersStatus> {
  return await reply(await fetch(`${API_PREFIX}/sessions/folders?id=${encodeURIComponent(session)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folders }), signal }))
}
