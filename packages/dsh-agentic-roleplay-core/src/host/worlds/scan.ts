import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorldProblem, WorldSummary } from '../../shared/worlds.ts'
import { parseWorldFile, WORLD_FILE_NAME, WorldFileError } from './world-file.ts'

/** Where a world bundle lists its media files. */
const MEDIA_MANIFEST = 'media/manifest.jsonl'

/** A world file is a small description; anything larger is not one. */
const MAX_WORLD_FILE_BYTES = 1024 * 1024

/** Raster formats only: they cannot carry script when opened directly. */
const COVER_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

export interface WorldCover {
  file: string
  contentType: string
  size: number
  /** Changes whenever the file does. */
  version: string
}

export interface WorldRecord {
  summary: WorldSummary
  cover?: WorldCover
}

export interface ScanResult {
  worlds: WorldRecord[]
  problems: WorldProblem[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the worlds of `worldsDir`: each direct subfolder holding a
 * `world.json` is one world. Folders without one and symbolic links are
 * skipped.
 */
export async function scanWorlds(worldsDir: string): Promise<ScanResult> {
  const result: ScanResult = { worlds: [], problems: [] }

  let entries
  try {
    entries = await readdir(worldsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    result.problems.push({ path: worldsDir, message: errorMessage(error) })
    return result
  }

  for (const entry of entries.filter(candidate => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(worldsDir, entry.name)
    const file = join(dir, WORLD_FILE_NAME)
    try {
      if (!(await stat(file).catch(() => undefined))?.isFile()) continue
      const record = await loadWorld(entry.name, dir, file, result.problems)
      result.worlds.push(record)
    } catch (error) {
      result.problems.push({ path: file, message: errorMessage(error) })
    }
  }

  result.worlds.sort((a, b) =>
    a.summary.name.localeCompare(b.summary.name) || a.summary.id.localeCompare(b.summary.id))
  return result
}

async function loadWorld(id: string, dir: string, file: string, problems: WorldProblem[]): Promise<WorldRecord> {
  if ((await stat(file)).size > MAX_WORLD_FILE_BYTES) throw new WorldFileError('file is too large')
  const world = parseWorldFile(await readFile(file, 'utf8'))
  const record: WorldRecord = {
    summary: {
      id,
      name: world.name,
      description: world.description,
      tags: world.tags,
      ...(world.author === undefined ? {} : { author: world.author }),
    },
  }
  // The cover is optional; a world that names one it cannot supply is still listed, with the reason reported.
  if (world.coverMediaId !== undefined) {
    try {
      record.cover = await resolveCover(dir, world.coverMediaId)
      record.summary = { ...record.summary, coverVersion: record.cover.version }
    } catch (error) {
      problems.push({ path: file, message: `cover: ${errorMessage(error)}` })
    }
  }
  return record
}

/** The cover is a row of the world's media manifest, whose `file` points into the world folder. */
async function findMediaFile(worldDir: string, mediaId: string): Promise<string> {
  let text: string
  try {
    text = await readFile(join(worldDir, MEDIA_MANIFEST), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${MEDIA_MANIFEST} not found`)
    throw error
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      throw new Error(`${MEDIA_MANIFEST} is not valid JSON lines`)
    }
    if (typeof row === 'object' && row !== null && (row as { id?: unknown }).id === mediaId) {
      const file = (row as { file?: unknown }).file
      if (typeof file !== 'string' || file === '') throw new Error(`media "${mediaId}" has no file`)
      return file
    }
  }
  throw new Error(`media "${mediaId}" is not in ${MEDIA_MANIFEST}`)
}

async function resolveCover(worldDir: string, mediaId: string): Promise<WorldCover> {
  const cover = await findMediaFile(worldDir, mediaId)
  const contentType = COVER_CONTENT_TYPES[extname(cover).toLowerCase()]
  if (contentType === undefined) throw new Error(`unsupported image type "${extname(cover)}"`)
  const file = resolve(worldDir, cover)
  const inside = relative(worldDir, file)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new Error('must be inside the world folder')
  // A link inside the folder must not lead the server to a file outside it.
  const real = await realpath(file).catch((error: unknown) => {
    throw (error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('file not found') : error
  })
  const realInside = relative(await realpath(worldDir), real)
  if (realInside.startsWith('..') || isAbsolute(realInside)) throw new Error('must be inside the world folder')
  const info = await stat(real)
  if (!info.isFile()) throw new Error('is not a file')
  return {
    file: real,
    contentType,
    size: info.size,
    version: `${Math.trunc(info.mtimeMs).toString(36)}-${info.size.toString(36)}`,
  }
}
