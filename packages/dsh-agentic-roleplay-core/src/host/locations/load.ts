import { join } from 'node:path'
import type { LocationDefinition } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { LOCATION_FILE_NAME, parseLocationFile } from './location-file.ts'

export const LOCATIONS_DIR = 'locations'

/** At most this many places in one world. */
export const MAX_LOCATIONS = 500

export interface LoadedLocations {
  locations: LocationDefinition[]
  problems: WorldProblem[]
}

/**
 * Read the places of one world: every subfolder of `<world>/locations/` that holds a
 * `location.json`. A world with no such folder has no places, which is fine. Ids must be unique;
 * every parent and every exit must lead to a place of the world, and the places must not contain
 * each other in a circle. Every problem is reported with the file it is in.
 */
export async function loadLocations(worldDir: string): Promise<LoadedLocations> {
  const dir = join(worldDir, LOCATIONS_DIR)
  const result: LoadedLocations = { locations: [], problems: [] }

  let folders: string[]
  try {
    folders = await subfolders(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: dir, message: errorMessage(error) })
    return result
  }

  const files = new Map<string, string>()
  for (const folder of folders) {
    const file = join(dir, folder, LOCATION_FILE_NAME)
    try {
      const location = await readDocument(file, text => parseLocationFile(text, folder), result.problems)
      if (location === undefined) continue
      const owner = files.get(location.id)
      if (owner !== undefined) {
        result.problems.push({ path: file, message: `id "${location.id}" is already used by ${owner}` })
        continue
      }
      files.set(location.id, folder)
      result.locations.push(location)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
    }
  }
  if (result.locations.length > MAX_LOCATIONS) result.problems.push({ path: dir, message: `a world has at most ${MAX_LOCATIONS} places` })

  const byId = new Map(result.locations.map(location => [location.id, location]))
  const fileOf = (id: string): string => join(dir, files.get(id) ?? id, LOCATION_FILE_NAME)
  for (const location of result.locations) {
    if (location.parent !== undefined && !byId.has(location.parent)) result.problems.push({ path: fileOf(location.id), message: `parent: "${location.parent}" is not a place of this world` })
    if (location.parent === location.id) result.problems.push({ path: fileOf(location.id), message: 'parent: a place cannot be in itself' })
    location.exits.forEach((exit, index) => {
      if (!byId.has(exit.to)) result.problems.push({ path: fileOf(location.id), message: `exits[${index}].to: "${exit.to}" is not a place of this world` })
      if (exit.to === location.id) result.problems.push({ path: fileOf(location.id), message: `exits[${index}].to: an exit must lead to another place` })
    })
    const seen = new Set<string>()
    for (let up = location.parent === location.id ? undefined : location.parent; up !== undefined && byId.has(up); up = byId.get(up)?.parent) {
      if (up === location.id || seen.has(up)) {
        result.problems.push({ path: fileOf(location.id), message: 'parent: the places contain each other in a circle' })
        break
      }
      seen.add(up)
    }
  }
  return result
}

/** The places in an order where each comes after the one it is in. */
export function parentsFirst(locations: readonly LocationDefinition[]): LocationDefinition[] {
  const ordered: LocationDefinition[] = []
  const placed = new Set<string>()
  const byId = new Map(locations.map(location => [location.id, location]))
  const place = (location: LocationDefinition): void => {
    if (placed.has(location.id)) return
    placed.add(location.id)
    const parent = location.parent === undefined ? undefined : byId.get(location.parent)
    if (parent !== undefined) place(parent)
    ordered.push(location)
  }
  for (const location of locations) place(location)
  return ordered
}
