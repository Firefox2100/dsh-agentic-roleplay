import type { WorldCharactersPayload } from '../../shared/sessions.ts'
import { loadCharacters } from '../characters/load.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { WorldNotFoundError } from './errors.ts'

/**
 * The cast of a world, as the start dialog needs it.
 * @throws {WorldNotFoundError} when no world has that id.
 */
export async function worldCharacters(worlds: Pick<WorldCatalog, 'find'>, worldId: string): Promise<WorldCharactersPayload> {
  const world = await worlds.find(worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  const { characters, problems } = await loadCharacters(world.directory)
  return {
    characters: characters.map(({ id, name, summary, role, tier, kind }) => ({ id, name, summary, role, tier, kind })),
    problems,
  }
}
