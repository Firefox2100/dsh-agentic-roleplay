import type { GalleryFilter, GalleryImage, GalleryPage } from '../../../shared/gallery.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'

export type { GalleryFilter, GalleryImage, GalleryPage }

/** Whose pictures: a session's, or a world's. */
export interface GalleryTarget { kind: 'sessions' | 'worlds'; id: string }

const route = (target: GalleryTarget, path = ''): string => `${API_PREFIX}/${target.kind}/gallery${path}?id=${encodeURIComponent(target.id)}`

export interface GalleryContents {
  images: GalleryImage[]
  /** Why a picture that was added could not be described, by its path. */
  failures: Record<string, string>
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
  return new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
}

export async function loadGallery(target: GalleryTarget, signal: AbortSignal): Promise<GalleryContents> {
  const response = await fetch(route(target), { credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryContents
}

/** The newest pictures that match `filter`, `limit` of them from `offset`, with the counts of the whole gallery. */
export async function loadGalleryPage(target: GalleryTarget, query: { offset: number; limit: number; filter: GalleryFilter }, signal: AbortSignal): Promise<GalleryPage> {
  const response = await fetch(`${route(target)}&offset=${query.offset}&limit=${query.limit}&filter=${query.filter}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryPage
}

/** Adds a picture to the library. @returns its path. */
export async function uploadImage(target: GalleryTarget, file: File, signal: AbortSignal): Promise<string> {
  const response = await fetch(route(target, '/upload'), { method: 'POST', credentials: 'same-origin', headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: file, signal })
  if (!response.ok) throw await failure(response)
  return (await response.json() as { path: string }).path
}

export async function updateImage(target: GalleryTarget, path: string, update: { reusable?: boolean; description?: string; tags?: string[] }, signal: AbortSignal): Promise<GalleryImage> {
  const response = await fetch(`${route(target)}&path=${encodeURIComponent(path)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update), signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryImage
}

/** Has a model that reads images describe a picture of a world, replacing its description, tags and subjects. */
export async function describeImage(target: GalleryTarget, path: string, signal: AbortSignal): Promise<GalleryImage> {
  const response = await fetch(`${route(target, '/describe')}&path=${encodeURIComponent(path)}`, { method: 'POST', credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  return await response.json() as GalleryImage
}

export const imageUrl = (target: GalleryTarget, image: GalleryImage): string => `${route(target, '/file')}&path=${encodeURIComponent(image.path)}&v=${encodeURIComponent(image.createdAt)}`
