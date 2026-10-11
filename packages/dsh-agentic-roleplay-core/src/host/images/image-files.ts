import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { readPngMetadata, withPngMetadata } from './png-metadata.ts'
import type { VisualImageMetadata } from './storage.ts'

/** Raster formats a person may bring. Only PNG can carry its metadata inside; the others have a sidecar `<file>.json`. */
export const MEDIA_TYPES: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

export const mediaTypeOf = (path: string): string | undefined => MEDIA_TYPES[extname(path).toLowerCase()]

export const sidecarOf = (file: string): string => `${file}.json`

/** What an image file says about itself: inside a PNG, beside any other format. Nothing when it says nothing readable. */
export async function readImageFileMetadata(file: string): Promise<Partial<VisualImageMetadata> | undefined> {
  if (extname(file).toLowerCase() === '.png') {
    try { return readPngMetadata(await readFile(file)) as Partial<VisualImageMetadata> | undefined } catch { return undefined }
  }
  try { return JSON.parse(await readFile(sidecarOf(file), 'utf8')) as Partial<VisualImageMetadata> } catch { return undefined }
}

async function replaceAtomically(file: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.writing`
  await writeFile(temporary, data)
  await rename(temporary, file)
}

/** Writes the metadata where the format keeps it, replacing what was there. */
export async function writeImageFileMetadata(file: string, metadata: VisualImageMetadata): Promise<void> {
  if (extname(file).toLowerCase() === '.png') await replaceAtomically(file, withPngMetadata(await readFile(file), metadata))
  else await replaceAtomically(sidecarOf(file), `${JSON.stringify(metadata, null, 2)}\n`)
}
