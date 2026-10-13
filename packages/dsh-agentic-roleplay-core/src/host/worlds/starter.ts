import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StarterWorld } from '../../shared/starter.ts'
import type { WorldSummary } from '../../shared/worlds.ts'
import type { WorldCatalog } from './catalog.ts'
import { WORLD_FILE_NAME } from './world-file.ts'
import { WorldFolderExistsError } from './create-world.ts'

export const STARTER_FOLDER = 'starter-worlds'

/** Names a starter world that the package does not ship. */
export class UnknownStarterError extends Error {}

/** The folder of the worlds that ship with the package, found from this module so that it works from source and from the build. */
export function starterDirectory(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, STARTER_FOLDER)
    if (existsSync(join(directory, 'package.json')) && existsSync(candidate)) return candidate
    if (dirname(directory) === directory) throw new Error('the starter worlds shipped with the package were not found')
  }
}

interface Shipped { folder: string; id: string; name: string; description: string; tags: string[] }

async function shipped(directory: string): Promise<Shipped[]> {
  const found: Shipped[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const document = JSON.parse(await readFile(join(directory, entry.name, WORLD_FILE_NAME), 'utf8')) as { id?: unknown; name?: unknown; description?: unknown; metadata?: { tags?: unknown } }
    if (typeof document.id !== 'string' || typeof document.name !== 'string') throw new Error(`the starter world "${entry.name}" has no id or name`)
    found.push({ folder: entry.name, id: document.id, name: document.name, description: typeof document.description === 'string' ? document.description : '', tags: Array.isArray(document.metadata?.tags) ? document.metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [] })
  }
  return found.sort((a, b) => a.folder.localeCompare(b.folder))
}

/** The worlds the package ships, each with whether the person's worlds have it already. */
export async function listStarterWorlds(catalog: WorldCatalog, directory: string = starterDirectory()): Promise<StarterWorld[]> {
  const known = await catalog.list()
  return (await shipped(directory)).map(({ id, ...world }) => ({ ...world, installed: known.worlds.some(existing => existing.id === id) || existsSync(join(catalog.directory, world.folder)) }))
}

/**
 * Copies a shipped world into the person's worlds, as a world of their own to play and edit, and makes the catalogue see it. Nothing is overwritten.
 * @throws {UnknownStarterError} when the package ships no such world.
 * @throws {WorldFolderExistsError} when the person already has that folder or a world with the same id.
 */
export async function addStarterWorld(catalog: WorldCatalog, folder: string, directory: string = starterDirectory()): Promise<WorldSummary> {
  const world = (await shipped(directory)).find(candidate => candidate.folder === folder)
  if (world === undefined) throw new UnknownStarterError(`there is no starter world "${folder}"`)
  const known = await catalog.list({ refresh: true })
  if (known.worlds.some(existing => existing.id === world.id)) throw new WorldFolderExistsError(`you already have "${world.name}"`)
  const target = join(catalog.directory, world.folder)
  if (existsSync(target)) throw new WorldFolderExistsError(`a world folder named "${world.folder}" already exists`)
  await mkdir(catalog.directory, { recursive: true })
  try {
    await cp(join(directory, world.folder), target, { recursive: true, errorOnExist: true, force: false })
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
  const added = (await catalog.list({ refresh: true })).worlds.find(candidate => candidate.id === world.id)
  if (added === undefined) throw new Error(`added "${world.name}" but it was not found when the catalogue refreshed`)
  return added
}
