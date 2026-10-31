import { loadCharacters } from '../characters/load.ts'
import { loadFactions } from '../factions/load.ts'
import { loadItems } from '../items/load.ts'
import { loadLocations } from '../locations/load.ts'
import { loadLore } from '../lore/load.ts'
import { loadVariables } from '../variables/load.ts'
import { checkWorld } from '../worlds/world-check.ts'
import { readWorldInfo } from '../worlds/world-info.ts'
import type { CheckInput } from './check.ts'
import { madeInto, type CardEvidence } from './card-evidence.ts'
import { readWorldText } from './world-text.ts'

function once<T>(input: CheckInput, key: string, load: () => Promise<T>): Promise<T> {
  if (input.memo === undefined) return load()
  let loaded = input.memo.get(key) as Promise<T> | undefined
  if (loaded === undefined) { loaded = load(); input.memo.set(key, loaded) }
  return loaded
}

/** The parts of the world as the checks of one run read them. */
export const loaded = {
  validity: (input: CheckInput) => once(input, 'validity', () => checkWorld(input.world)),
  characters: (input: CheckInput) => once(input, 'characters', () => loadCharacters(input.world.directory)),
  locations: (input: CheckInput) => once(input, 'locations', () => loadLocations(input.world.directory)),
  factions: (input: CheckInput) => once(input, 'factions', () => loadFactions(input.world.directory)),
  lore: (input: CheckInput) => once(input, 'lore', () => loadLore(input.world.directory)),
  variables: (input: CheckInput) => once(input, 'variables', () => loadVariables(input.world.directory)),
  info: (input: CheckInput) => once(input, 'info', () => readWorldInfo(input.world.directory)),
  text: (input: CheckInput) => once(input, 'text', () => readWorldText(input.world.directory)),
  /** Which parts of the world each piece of the card the records are about was made into. */
  made: async (input: CheckInput, card: CardEvidence, only: 'any' | 'about' = 'any') => {
    const world = await loaded.text(input)
    return once(input, `made:${only}`, async () => madeInto(card.previous ?? card.source, world, only))
  },
  items: async (input: CheckInput) => {
    const [{ characters }, { locations }] = await Promise.all([loaded.characters(input), loaded.locations(input)])
    return once(input, 'items', () => loadItems(input.world.directory, { characters: characters.map(character => character.id), locations }))
  },
}
