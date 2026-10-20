import { randomUUID } from 'node:crypto'
import { mkdir, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorldSummary } from '../../shared/worlds.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { isPresetName } from '../presets/presets.ts'
import type { WorldCatalog } from './catalog.ts'
import { WORLD_FILE_NAME } from './world-file.ts'

const FOLDER = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,99}$/u

export class WorldFolderExistsError extends Error {}

/** Create the smallest valid authored world, exclusively, then make the catalogue see it. */
export async function createWorld(catalog: WorldCatalog, input: { folder: string; name: string; preset?: string }): Promise<WorldSummary> {
  const folder = input.folder.trim()
  const name = input.name.trim()
  const problems: string[] = []
  if (folder === '' || !FOLDER.test(folder) || folder === '.' || folder === '..' || /[. ]$/.test(folder)) problems.push('folder must be 1–100 letters, numbers, spaces, dots, underscores or hyphens; it cannot end in a dot or space')
  if (name === '') problems.push('world name is required')
  if (name.length > 200) problems.push('world name must be at most 200 characters')
  if (input.preset !== undefined && input.preset !== '' && !isPresetName(input.preset)) problems.push('preset must be the name of a preset in the library')
  if (problems.length > 0) throw new InvalidEditProblems(problems)

  await mkdir(catalog.directory, { recursive: true })
  const directory = join(catalog.directory, folder)
  try {
    await mkdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorldFolderExistsError(`a world folder named "${folder}" already exists`)
    throw error
  }
  const id = randomUUID()
  try {
    await writeFile(join(directory, WORLD_FILE_NAME), JSON.stringify({ id, name, description: '', metadata: { tags: [] }, ...(input.preset === undefined || input.preset === '' ? {} : { preset: input.preset }) }, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
  } catch (error) {
    await rmdir(directory).catch(() => undefined)
    throw error
  }
  const payload = await catalog.list({ refresh: true })
  const created = payload.worlds.find(world => world.id === id)
  if (created === undefined) throw new Error(`created world "${name}" but it was not found when the catalogue refreshed`)
  return created
}
