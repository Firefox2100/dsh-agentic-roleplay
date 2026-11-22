import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { sidecarOf } from './image-files.ts'
import { linkOrCopy } from './storage.ts'

const BASE_FILE = '.base.json'
/** The folders of `images/` a world brings and a story starts with; scenes and what is shown are the story's own. */
const SHARED_FOLDERS = new Set(['global', 'characters', 'locations', 'items', 'library'])

/** Whether a path under `images/` is one of those a story reads from its world until it needs a copy of its own. */
export const isSharedPath = (path: string): boolean => SHARED_FOLDERS.has(path.split('/')[0] ?? '')

/**
 * A story does not copy its world's pictures: it records which world it started from (`images/.base.json`, a folder of the roleplay root)
 * and reads the pictures it has not made or changed from there. This keeps a story small to sync, export and branch.
 * @returns false when the world is not a folder of the root, so the story has to copy them.
 */
export async function shareWorldImages(sessionFolder: string, worldDirectory: string): Promise<boolean> {
  const path = relative(dirname(dirname(sessionFolder)), worldDirectory).split(sep)
  if (path.length !== 2 || path[0] !== 'worlds' || path[1] === '' || path[1] === '..') return false
  await mkdir(join(sessionFolder, 'images'), { recursive: true })
  await writeFile(join(sessionFolder, 'images', BASE_FILE), JSON.stringify({ world: path.join('/') }))
  return true
}

/** The folder of the world a story reads pictures from, when it has one that is still there. */
export function baseWorld(sessionFolder: string): string | undefined {
  let named: unknown
  try { named = (JSON.parse(readFileSync(join(sessionFolder, 'images', BASE_FILE), 'utf8')) as { world?: unknown }).world } catch { return undefined }
  if (typeof named !== 'string') return undefined
  const parts = named.split('/')
  if (parts.length !== 2 || parts[0] !== 'worlds' || parts[1] === '' || parts[1] === '.' || parts[1] === '..') return undefined
  const directory = join(dirname(dirname(sessionFolder)), 'worlds', parts[1]!)
  return existsSync(directory) ? directory : undefined
}

/** The file to read for a picture of a story: its own, or else the world's, when the story has not made or changed it. */
export function sharedFile(sessionFolder: string, file: string): string {
  if (existsSync(file)) return file
  const base = baseWorld(sessionFolder)
  if (base === undefined) return file
  const inside = relative(join(sessionFolder, 'images'), file)
  if (inside.startsWith('..') || isAbsolute(inside) || !isSharedPath(inside.split(sep).join('/'))) return file
  const candidate = join(base, 'images', inside)
  return existsSync(candidate) ? candidate : file
}

/** Gives the story a file of its own for a picture it is about to change or keep, so that the world's later changes do not reach it. */
export async function materialize(sessionFolder: string, path: string): Promise<void> {
  const local = join(sessionFolder, 'images', ...path.split('/'))
  if (existsSync(local) || !isSharedPath(path)) return
  const source = sharedFile(sessionFolder, local)
  if (source === local) return
  await mkdir(dirname(local), { recursive: true })
  await linkOrCopy(source, local)
  if (existsSync(sidecarOf(source))) await linkOrCopy(sidecarOf(source), sidecarOf(local))
}
