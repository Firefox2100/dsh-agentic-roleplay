import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { LIBRARY_FOLDER, type GalleryImage } from '../../shared/gallery.ts'
import { mapLimit } from '../import/run.ts'
import { mediaTypeOf, readImageFileMetadata, sidecarOf, writeImageFileMetadata } from './image-files.ts'
import type { VisualImageMetadata } from './storage.ts'

export type { GalleryImage }

const READ_AT_ONCE = 8
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]{0,199}$/u
const CACHE_FILE = '.index.json'
const CACHE_VERSION = 1

interface FileFacts { path: string; signature: string }
interface Cache { version: number; entries: Record<string, { signature: string; image: GalleryImage }> }

/** The images of the folder: every PNG, and the other raster formats inside the library, whose metadata is beside them. */
async function imageFiles(images: string, prefix = ''): Promise<string[]> {
  let entries
  try { entries = await readdir(join(images, prefix), { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const path = `${prefix}${entry.name}`
    if (entry.isDirectory()) found.push(...await imageFiles(images, `${path}/`))
    else if (entry.isFile() && (entry.name.toLowerCase().endsWith('.png') || (path.startsWith(`${LIBRARY_FOLDER}/`) && mediaTypeOf(entry.name) !== undefined))) found.push(path)
  }
  return found
}

async function factsOf(images: string, path: string): Promise<FileFacts> {
  const file = join(images, ...path.split('/'))
  const info = await lstat(file)
  const beside = path.toLowerCase().endsWith('.png') ? undefined : await stat(sidecarOf(file)).then(value => value.mtimeMs, () => 0)
  return { path, signature: `${info.mtimeMs}:${info.size}:${beside ?? ''}` }
}

async function describe(images: string, path: string): Promise<GalleryImage> {
  const file = join(images, ...path.split('/'))
  const { mtime } = await lstat(file)
  const library = path.startsWith(`${LIBRARY_FOLDER}/`)
  const metadata = await readImageFileMetadata(file)
  if (metadata === undefined || typeof metadata !== 'object') {
    // A file the person put in the library has no metadata yet: it is waiting to be described, not broken.
    return library
      ? { path, purpose: 'uploaded', origin: 'uploaded', reusable: true, createdAt: mtime.toISOString(), tags: [], subjects: [], pending: true }
      : { path, purpose: path.startsWith('scenes/') ? 'transient' : 'reference', origin: 'generated', reusable: false, createdAt: mtime.toISOString(), tags: [], subjects: [], unreadable: true }
  }
  const origin = metadata.origin ?? (library ? 'uploaded' : 'generated')
  const purpose = metadata.purpose ?? (origin === 'uploaded' ? 'uploaded' : path.startsWith('scenes/') ? 'transient' : 'reference')
  return {
    path,
    purpose,
    origin,
    reusable: origin === 'uploaded' ? true : metadata.reusable ?? purpose === 'reference',
    createdAt: metadata.createdAt ?? mtime.toISOString(),
    ...(metadata.prompt === undefined ? {} : { prompt: metadata.prompt }),
    ...(metadata.revisedPrompt === undefined ? {} : { revisedPrompt: metadata.revisedPrompt }),
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    tags: metadata.tags ?? [],
    ...(metadata.provider === undefined ? {} : { provider: metadata.provider }),
    ...(metadata.model === undefined ? {} : { model: metadata.model }),
    subjects: (metadata.subjects ?? []).map(subject => ({ kind: subject.kind, name: subject.name })),
    ...(metadata.source === undefined ? {} : { source: metadata.source }),
    ...(metadata.originalName === undefined ? {} : { originalName: metadata.originalName }),
    ...(origin === 'uploaded' && metadata.description === undefined ? { pending: true } : {}),
  }
}

export async function describeGalleryImage(sessionFolder: string, path: string): Promise<GalleryImage> {
  return await describe(join(sessionFolder, 'images'), path)
}

async function readCache(images: string): Promise<Cache> {
  try {
    const cache = JSON.parse(await readFile(join(images, CACHE_FILE), 'utf8')) as Cache
    if (cache.version === CACHE_VERSION && typeof cache.entries === 'object' && cache.entries !== null) return cache
  } catch { /* a missing or unreadable cache is rebuilt */ }
  return { version: CACHE_VERSION, entries: {} }
}

async function writeCache(images: string, cache: Cache): Promise<void> {
  await mkdir(images, { recursive: true })
  const file = join(images, CACHE_FILE)
  const temporary = `${file}.${process.pid}.${randomUUID()}.writing`
  await writeFile(temporary, JSON.stringify(cache))
  await rename(temporary, file)
}

/**
 * Every image of a session folder with what its file says, newest first. The files are the truth; `images/.index.json` only remembers what
 * was read from each, keyed by its size and time, so that a listing reads just the files that are new or changed. It can be deleted at any time.
 */
export async function listGallery(sessionFolder: string): Promise<GalleryImage[]> {
  const images = join(sessionFolder, 'images')
  const paths = await imageFiles(images)
  if (paths.length === 0) return []
  const cache = await readCache(images)
  const facts = await mapLimit(paths, READ_AT_ONCE, path => factsOf(images, path))
  const entries: Cache['entries'] = {}
  let changed = Object.keys(cache.entries).length !== paths.length
  const described = await mapLimit(facts, READ_AT_ONCE, async ({ path, signature }) => {
    const known = cache.entries[path]
    if (known?.signature === signature) { entries[path] = known; return known.image }
    changed = true
    const image = await describe(images, path)
    entries[path] = { signature, image }
    return image
  })
  if (changed) await writeCache(images, { version: CACHE_VERSION, entries })
  return described.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.path.localeCompare(b.path))
}

/**
 * The file of a gallery image by its path, which must be one the listing gives: a raster image inside the session's images, not reached through a link.
 * @throws {Error} when the path names no such image.
 */
export async function galleryFile(sessionFolder: string, path: string): Promise<{ file: string; size: number; mediaType: string }> {
  const parts = path.split('/')
  const mediaType = mediaTypeOf(path)
  if (parts.length === 0 || mediaType === undefined || (mediaType !== 'image/png' && parts[0] !== LIBRARY_FOLDER) || parts.some(part => !SEGMENT.test(part) || part === '.' || part === '..')) throw new Error('there is no such image')
  const images = join(sessionFolder, 'images')
  const file = join(images, ...parts)
  const info = await lstat(file).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error('there is no such image')
  const real = await realpath(file)
  if (!real.startsWith(`${await realpath(images)}${sep}`)) throw new Error('there is no such image')
  return { file, size: info.size, mediaType }
}

/** What a person or the interpreter may say about an image afterwards. */
export interface ImageUpdate {
  description?: string
  tags?: string[]
  subjects?: { kind: 'character' | 'location' | 'item'; name: string }[]
  reusable?: boolean
  interpretedBy?: string
}

/**
 * Changes what an image says about itself, in the file. An image the person brought is always reusable.
 * @throws {Error} when the path names no image of the session, or an uploaded image is made not reusable.
 */
export async function updateImage(sessionFolder: string, path: string, update: ImageUpdate): Promise<GalleryImage> {
  const { file } = await galleryFile(sessionFolder, path)
  const current = await describe(join(sessionFolder, 'images'), path)
  if (update.reusable === false && current.origin === 'uploaded') throw new Error('an image you brought is always reusable: otherwise it would only sit there')
  const existing = await readImageFileMetadata(file)
  const base: VisualImageMetadata = {
    schema: 'dsh-roleplay-image/v3', purpose: current.purpose, origin: current.origin, reusable: current.reusable, createdAt: current.createdAt, tags: current.tags,
    subjects: current.subjects.map(subject => ({ kind: subject.kind as 'character', localId: subject.name, name: subject.name })),
    ...existing,
  }
  const next: VisualImageMetadata = {
    ...base, schema: 'dsh-roleplay-image/v3', origin: current.origin,
    ...(update.description === undefined ? {} : { description: update.description }),
    ...(update.tags === undefined ? {} : { tags: update.tags }),
    ...(update.subjects === undefined ? {} : { subjects: update.subjects.map(subject => ({ kind: subject.kind, localId: subject.name, name: subject.name })) }),
    ...(update.reusable === undefined ? {} : { reusable: update.reusable }),
    ...(update.interpretedBy === undefined ? {} : { interpretedBy: update.interpretedBy }),
  }
  await writeImageFileMetadata(file, next)
  return await describe(join(sessionFolder, 'images'), path)
}

