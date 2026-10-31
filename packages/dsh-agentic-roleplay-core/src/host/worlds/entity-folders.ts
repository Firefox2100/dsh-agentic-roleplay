import { CHARACTER_FILE_NAME } from '../characters/character-file.ts'
import { CHARACTERS_DIR } from '../characters/load.ts'
import { FACTION_FILE_NAME } from '../factions/faction-file.ts'
import { FACTIONS_DIR } from '../factions/load.ts'
import { ITEM_FILE_NAME } from '../items/item-file.ts'
import { ITEMS_DIR } from '../items/load.ts'
import { LOCATION_FILE_NAME } from '../locations/location-file.ts'
import { LOCATIONS_DIR } from '../locations/load.ts'
import { LORE_FILE_NAME } from '../lore/lore-file.ts'
import { LORE_DIR } from '../lore/load.ts'

/** The five kinds of entity a world is made of: where each lives (`<directory>/<id>/<file>`) and the key of its group in the importer's output. */
export const ENTITY_FOLDERS = [
  { key: 'characters', directory: CHARACTERS_DIR, file: CHARACTER_FILE_NAME },
  { key: 'locations', directory: LOCATIONS_DIR, file: LOCATION_FILE_NAME },
  { key: 'factions', directory: FACTIONS_DIR, file: FACTION_FILE_NAME },
  { key: 'items', directory: ITEMS_DIR, file: ITEM_FILE_NAME },
  { key: 'lore', directory: LORE_DIR, file: LORE_FILE_NAME },
] as const
