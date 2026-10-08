import { join } from 'node:path'
import type { LoreDefinition } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { LORE_FILE_NAME, parseLoreFile } from './lore-file.ts'

export const LORE_DIR = 'lore'
export const MAX_LORE = 500

export async function loadLore(worldDir: string): Promise<{ lore: LoreDefinition[]; problems: WorldProblem[] }> {
  const dir = join(worldDir, LORE_DIR); const result: { lore: LoreDefinition[]; problems: WorldProblem[] } = { lore: [], problems: [] }
  let folders: string[]
  try { folders = await subfolders(dir) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: dir, message: errorMessage(error) }); return result }
  const owners = new Map<string, string>()
  for (const folder of folders) {
    const file = join(dir, folder, LORE_FILE_NAME)
    try {
      const entry = await readDocument(file, text => parseLoreFile(text, folder), result.problems)
      if (entry === undefined) continue
      const owner = owners.get(entry.id)
      if (owner !== undefined) { result.problems.push({ path: file, message: `id "${entry.id}" is already used by ${owner}` }); continue }
      owners.set(entry.id, folder); result.lore.push(entry)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) }) }
  }
  if (result.lore.length > MAX_LORE) result.problems.push({ path: dir, message: `a world has at most ${MAX_LORE} lore entries` })
  return result
}
