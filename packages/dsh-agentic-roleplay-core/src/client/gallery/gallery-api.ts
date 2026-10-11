import type { GalleryImage } from '../../shared/gallery.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

export type { GalleryImage }

export interface GalleryContents {
  images: GalleryImage[]
  /** Why a picture that was added could not be described, by its path. */
  failures: Record<string, string>
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
  return new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
}

export async function loadGallery(session: string, signal: AbortSignal): Promise<GalleryContents> {
  const response = await fetch(`${API_PREFIX}/sessions/gallery?id=${encodeURIComponent(session)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryContents
}

/** Adds a picture to the session's library. @returns its path. */
export async function uploadImage(session: string, file: File, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${API_PREFIX}/sessions/gallery/upload?id=${encodeURIComponent(session)}`, { method: 'POST', credentials: 'same-origin', headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: file, signal })
  if (!response.ok) throw await failure(response)
  return (await response.json() as { path: string }).path
}

export async function updateImage(session: string, path: string, update: { reusable?: boolean; description?: string; tags?: string[] }, signal: AbortSignal): Promise<GalleryImage> {
  const response = await fetch(`${API_PREFIX}/sessions/gallery?id=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update), signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryImage
}

export const imageUrl = (session: string, image: GalleryImage): string => `${API_PREFIX}/sessions/gallery/file?id=${encodeURIComponent(session)}&path=${encodeURIComponent(image.path)}&v=${encodeURIComponent(image.createdAt)}`
