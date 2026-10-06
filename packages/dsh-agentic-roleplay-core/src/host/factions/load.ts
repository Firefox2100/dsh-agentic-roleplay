import { join } from 'node:path'
import type { FactionDefinition } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { FACTION_FILE_NAME, parseFactionFile } from './faction-file.ts'

export const FACTIONS_DIR = 'factions'
export const MAX_FACTIONS = 100

export async function loadFactions(worldDir: string): Promise<{ factions: FactionDefinition[]; problems: WorldProblem[] }> {
  const dir = join(worldDir, FACTIONS_DIR)
  const result: { factions: FactionDefinition[]; problems: WorldProblem[] } = { factions: [], problems: [] }
  let folders: string[]
  try { folders = await subfolders(dir) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: dir, message: errorMessage(error) }); return result }
  const owners = new Map<string, string>()
  for (const folder of folders) {
    const file = join(dir, folder, FACTION_FILE_NAME)
    try {
      const faction = await readDocument(file, text => parseFactionFile(text, folder), result.problems)
      if (faction === undefined) continue
      const owner = owners.get(faction.id)
      if (owner !== undefined) { result.problems.push({ path: file, message: `id "${faction.id}" is already used by ${owner}` }); continue }
      owners.set(faction.id, folder); result.factions.push(faction)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) }) }
  }
  if (result.factions.length > MAX_FACTIONS) result.problems.push({ path: dir, message: `a world has at most ${MAX_FACTIONS} factions` })
  return result
}
