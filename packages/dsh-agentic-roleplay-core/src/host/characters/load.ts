import { join } from 'node:path'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { CHARACTER_FILE_NAME, parseCharacterFile } from './character-file.ts'

export const CHARACTERS_DIR = 'characters'

export interface LoadedCharacters {
  characters: CharacterDefinition[]
  problems: WorldProblem[]
}

/**
 * Read the cast of one world: every subfolder of `<world>/characters/` that
 * holds a `character.json`. Ids must be unique; a repeated one is reported and
 * the later character skipped.
 */
export async function loadCharacters(worldDir: string): Promise<LoadedCharacters> {
  const dir = join(worldDir, CHARACTERS_DIR)
  const result: LoadedCharacters = { characters: [], problems: [] }

  let folders: string[]
  try {
    folders = await subfolders(dir)
  } catch (error) {
    result.problems.push({ path: dir, message: errorMessage(error) })
    return result
  }

  const folderById = new Map<string, string>()
  for (const folder of folders) {
    const file = join(dir, folder, CHARACTER_FILE_NAME)
    try {
      const character = await readDocument(file, text => parseCharacterFile(text, folder), result.problems)
      if (character === undefined) continue
      const owner = folderById.get(character.id)
      if (owner !== undefined) {
        result.problems.push({ path: file, message: `id "${character.id}" is already used by ${owner}` })
        continue
      }
      folderById.set(character.id, folder)
      result.characters.push(character)
    } catch (error) {
      // A folder without a character.json is not a character.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
    }
  }
  return result
}
