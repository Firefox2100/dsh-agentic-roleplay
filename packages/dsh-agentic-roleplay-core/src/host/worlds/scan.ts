import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorldProblem, WorldSummary } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { assignWorldId } from './world-id.ts'
import { parseWorldFile, WORLD_FILE_NAME, type OpeningSegment, type WorldClock, type WorldFile } from './world-file.ts'

type WorldFileVariables = NonNullable<WorldFile['variables']>

/** Where a world bundle lists its media files. */
const MEDIA_MANIFEST = 'media/manifest.jsonl'

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
  /** Name of the world's folder. */
  folder: string
  /** Absolute path of the world's folder. */
  directory: string
  summary: WorldSummary
  cover?: WorldCover
  /** The opening of the world, when it has one. */
  opening?: OpeningSegment[]
  /** Where the story's time starts, when the world says. */
  clock?: WorldClock
  /** What the world itself starts with of what it tracks. */
  variables?: WorldFileVariables
  /** What is not allowed in the world. */
  rules?: string[]
}

export interface ScanResult {
  worlds: WorldRecord[]
  problems: WorldProblem[]
}

/**
 * Read the worlds of `worldsDir`: each direct subfolder holding a
 * `world.json` is one world. Folders without one and symbolic links are
 * skipped. A world file without an id gets one written into it, so the world
 * keeps its identity from then on; ids must be unique, and a repeated one
 * (a copied folder) is reported and the later world skipped.
 */
export async function scanWorlds(worldsDir: string): Promise<ScanResult> {
  const result: ScanResult = { worlds: [], problems: [] }

  let folders: string[]
  try {
    folders = await subfolders(worldsDir)
  } catch (error) {
    result.problems.push({ path: worldsDir, message: errorMessage(error) })
    return result
  }

  const folderById = new Map<string, string>()
  for (const folder of folders) {
    const dir = join(worldsDir, folder)
    const file = join(dir, WORLD_FILE_NAME)
    try {
      const record = await loadWorld(folder, dir, file, result.problems)
      if (record === undefined) continue
      const owner = folderById.get(record.summary.id)
      if (owner !== undefined) {
        result.problems.push({ path: file, message: `id "${record.summary.id}" is already used by ${owner}` })
        continue
      }
      folderById.set(record.summary.id, folder)
      result.worlds.push(record)
    } catch (error) {
      // A folder without a world.json is not a world.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
    }
  }

  result.worlds.sort((a, b) =>
    a.summary.name.localeCompare(b.summary.name) || a.summary.id.localeCompare(b.summary.id))
  return result
}

async function loadWorld(folder: string, dir: string, file: string, problems: WorldProblem[]): Promise<WorldRecord | undefined> {
  const world = await readDocument(file, parseWorldFile, problems)
  if (world === undefined) return undefined
  let id = world.id
  if (id === undefined) {
    // Without a stored id the world could not be found again, so it cannot be listed.
    try {
      id = await assignWorldId(file)
    } catch (error) {
      problems.push({ path: file, message: `has no id and one could not be added: ${errorMessage(error)}` })
      return undefined
    }
  }
  const record: WorldRecord = {
    folder,
    directory: dir,
    summary: {
      id,
      name: world.name,
      description: world.description,
      tags: world.tags,
      ...(world.author === undefined ? {} : { author: world.author }),
    },
    ...(world.opening === undefined ? {} : { opening: world.opening }),
    ...(world.clock === undefined ? {} : { clock: world.clock }),
    ...(world.variables === undefined ? {} : { variables: world.variables }),
    ...(world.rules === undefined ? {} : { rules: world.rules }),
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
