import { mkdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LIBRARY_FOLDER } from '../../shared/gallery.ts'
import { MEDIA_TYPES, writeImageFileMetadata } from './image-files.ts'
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

/** A file name made of the letters and digits of the name it came with, in any script. */
export function libraryName(original: string, extension: string, taken: (name: string) => boolean): string {
  const stem = (original.replace(/\.[^.]*$/, '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'image'
  for (let n = 1; ; n += 1) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${extension}`
    if (!taken(name)) return name
  }
}

/**
 * Puts an image the person brought into the session's library, with metadata that says where it came from and that it is reusable. What it
 * shows is not known yet: the interpreter fills that in.
 * @throws {Error} when the bytes are not a PNG, JPEG, WebP or GIF image.
 * @returns its path under `images/`.
 */
export async function addToLibrary(sessionFolder: string, bytes: Uint8Array, originalName: string): Promise<string> {
  const extension = imageExtensionOf(bytes)
  if (extension === undefined || MEDIA_TYPES[extension] === undefined) throw new Error('only PNG, JPEG, WebP and GIF images can be added')
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
  return `${LIBRARY_FOLDER}/${name}`
}
