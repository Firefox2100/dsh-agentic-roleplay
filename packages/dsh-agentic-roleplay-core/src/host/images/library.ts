import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { trimCharacters, withoutExtension } from '../../shared/text.ts'
import { LIBRARY_FOLDER } from '../../shared/gallery.ts'
import { MEDIA_TYPES, writeImageFileMetadata } from './image-files.ts'
import { pngPictureBytes } from './png-metadata.ts'
import type { VisualImageMetadata } from './storage.ts'

const MAGIC: readonly { type: string; test: (bytes: Uint8Array) => boolean }[] = [
  { type: '.png', test: bytes => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  { type: '.jpg', test: bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: '.gif', test: bytes => bytes.length > 6 && Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'GIF8' },
  { type: '.webp', test: bytes => bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP' },
]

/** The format the bytes are, by what they start with: a name or a declared type is not believed. */
export function imageExtensionOf(bytes: Uint8Array): string | undefined {
  return MAGIC.find(format => format.test(bytes))?.type
}

/** A hash of the picture itself: a PNG's metadata (ours is written into it after the file is saved) is left out, so the same picture hashes the same wherever it came from. */
export function pictureHash(bytes: Uint8Array): string {
  let picture: Uint8Array = bytes
  if (imageExtensionOf(bytes) === '.png') try { picture = pngPictureBytes(bytes) } catch { picture = bytes }
  return createHash('sha256').update(picture).digest('hex')
}

/** The pictures already in the library, by the hash of the picture: its path under `images/`. */
export async function libraryHashes(sessionFolder: string): Promise<Map<string, string>> {
  const directory = join(sessionFolder, 'images', LIBRARY_FOLDER)
  const found = new Map<string, string>()
  for (const name of await readdir(directory).catch((): string[] => [])) {
    if (MEDIA_TYPES[extname(name).toLowerCase()] === undefined) continue
    const bytes = await readFile(join(directory, name)).catch((): undefined => undefined)
    if (bytes !== undefined && imageExtensionOf(bytes) !== undefined) found.set(pictureHash(bytes), `${LIBRARY_FOLDER}/${name}`)
  }
  return found
}

/** A file name made of the letters and digits of the name it came with, in any script. */
export function libraryName(original: string, extension: string, taken: (name: string) => boolean): string {
  const stem = trimCharacters(withoutExtension(original).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-'), '-').slice(0, 60) || 'image'
  for (let n = 1; ; n += 1) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${extension}`
    if (!taken(name)) return name
  }
}

/**
 * Puts a picture into the library unless the library already holds that picture (the same image, whatever metadata the file carries), whatever it came from: an upload, an address, a generation.
 * Metadata says where it came from and that it is reusable; what it shows is not known yet, and the interpreter fills that in.
 * @param known the hashes of the library when the caller has read them (kept up to date here), to avoid reading the library again for each picture.
 * @throws {Error} when the bytes are not a PNG, JPEG, WebP or GIF image.
 * @returns its path under `images/`, and whether it was added or an equal picture was there.
 */
export async function addToLibraryOnce(sessionFolder: string, bytes: Uint8Array, originalName: string, known?: Map<string, string>): Promise<{ path: string; added: boolean }> {
  const extension = imageExtensionOf(bytes)
  if (extension === undefined || MEDIA_TYPES[extension] === undefined) throw new Error('only PNG, JPEG, WebP and GIF images can be added')
  const hashes = known ?? await libraryHashes(sessionFolder)
  const hash = pictureHash(bytes)
  const present = hashes.get(hash)
  if (present !== undefined) return { path: present, added: false }
  const directory = join(sessionFolder, 'images', LIBRARY_FOLDER)
  await mkdir(directory, { recursive: true })
  const name = libraryName(originalName, extension, candidate => existsSync(join(directory, candidate)))
  const file = join(directory, name)
  const temporary = `${file}.${process.pid}.${randomUUID()}.writing`
  await writeFile(temporary, bytes)
  await rename(temporary, file)
  const metadata: VisualImageMetadata = {
    schema: 'dsh-roleplay-image/v3', purpose: 'uploaded', origin: 'uploaded', reusable: true, createdAt: new Date().toISOString(),
    originalName, subjects: [], tags: [],
  }
  await writeImageFileMetadata(file, metadata)
  const path = `${LIBRARY_FOLDER}/${name}`
  hashes.set(hash, path)
  return { path, added: true }
}

/** {@link addToLibraryOnce} for a caller that only wants the path: a picture the library holds already is not added again. */
export async function addToLibrary(sessionFolder: string, bytes: Uint8Array, originalName: string): Promise<string> {
  return (await addToLibraryOnce(sessionFolder, bytes, originalName)).path
}
