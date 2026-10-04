import { join } from 'node:path'
import type { ItemDefinition, LocationDefinition, Slot } from 'dsh-roleplay-model'
import { DEFAULT_SLOTS } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { subfolders } from '../folders.ts'
import { readDocument } from '../read-document.ts'
import { ITEM_FILE_NAME, SLOTS_FILE_NAME, parseItemFile, parseSlotsFile } from './item-file.ts'

export const ITEMS_DIR = 'items'

/** At most this many items in one world. */
export const MAX_ITEMS = 2000

export interface LoadedItems {
  items: ItemDefinition[]
  /** The slots of the world: the usual ones, with what `slots.json` adds or changes. */
  slots: Slot[]
  problems: WorldProblem[]
}

/**
 * Read the things of one world: every subfolder of `<world>/items/` that holds an `item.json`, and an
 * optional `<world>/items/slots.json`. A world with no such folder has none. Ids must be unique; what
 * a thing is worn in must be a slot, and where it starts, who owns it, what opens it and what it is
 * inside must exist in the world, with no thing inside itself.
 */
export async function loadItems(worldDir: string, context: { characters: readonly string[]; locations: readonly LocationDefinition[] }): Promise<LoadedItems> {
  const dir = join(worldDir, ITEMS_DIR)
  const result: LoadedItems = { items: [], slots: DEFAULT_SLOTS.map(slot => ({ ...slot })), problems: [] }

  let folders: string[]
  try {
    folders = await subfolders(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: dir, message: errorMessage(error) })
    return result
  }

  try {
    const own = await readDocument(join(dir, SLOTS_FILE_NAME), parseSlotsFile, result.problems)
    for (const slot of own ?? []) {
      const at = result.slots.findIndex(existing => existing.id === slot.id)
      if (at < 0) result.slots.push(slot)
      else result.slots[at] = slot
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: join(dir, SLOTS_FILE_NAME), message: errorMessage(error) })
  }

  const folderOf = new Map<string, string>()
  for (const folder of folders) {
    const file = join(dir, folder, ITEM_FILE_NAME)
    try {
      const item = await readDocument(file, text => parseItemFile(text, folder), result.problems)
      if (item === undefined) continue
      const owner = folderOf.get(item.id)
      if (owner !== undefined) {
        result.problems.push({ path: file, message: `id "${item.id}" is already used by ${owner}` })
        continue
      }
      folderOf.set(item.id, folder)
      result.items.push(item)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
    }
  }
  if (result.items.length > MAX_ITEMS) result.problems.push({ path: dir, message: `a world has at most ${MAX_ITEMS} items` })

  const byId = new Map(result.items.map(item => [item.id, item]))
  const slotIds = new Set(result.slots.map(slot => slot.id))
  const places = new Map(context.locations.map(location => [location.id, location]))
  const characters = new Set(context.characters)
  const fileOf = (id: string): string => join(dir, folderOf.get(id) ?? id, ITEM_FILE_NAME)
  for (const item of result.items) {
    const problem = (message: string): void => { result.problems.push({ path: fileOf(item.id), message }) }
    if (item.wearable !== undefined && !slotIds.has(item.wearable)) problem(`wearable: "${item.wearable}" is not a slot (the slots are: ${[...slotIds].join(', ')}; add one in ${SLOTS_FILE_NAME})`)
    if (item.owner !== undefined && !characters.has(item.owner)) problem(`owner: "${item.owner}" is not a character of this world`)
    for (const key of item.container?.openedBy ?? []) if (!byId.has(key)) problem(`container.opened_by: "${key}" is not an item of this world`)
    const { start } = item
    if (start.kind === 'location') {
      const place = places.get(start.location)
      if (place === undefined) problem(`location: "${start.location}" is not a place of this world`)
      else if (start.feature !== undefined && !place.features.some(feature => feature.key === start.feature)) problem(`feature: ${place.name} has no feature "${start.feature}"`)
    } else if (start.kind === 'held' || start.kind === 'worn') {
      if (!characters.has(start.character)) problem(`${start.kind === 'held' ? 'held_by' : 'worn_by'}: "${start.character}" is not a character of this world`)
    } else if (start.kind === 'inside') {
      const box = byId.get(start.item)
      if (box === undefined) problem(`inside: "${start.item}" is not an item of this world`)
      else if (box.container === undefined) problem(`inside: ${box.name} is not a container`)
      const seen = new Set<string>([item.id])
      for (let up: ItemDefinition | undefined = box; up !== undefined; up = up.start.kind === 'inside' ? byId.get(up.start.item) : undefined) {
        if (seen.has(up.id)) { problem('inside: the items are inside each other in a circle'); break }
        seen.add(up.id)
      }
    }
  }
  // What opens a way: the ids written on the places' exits.
  for (const place of context.locations) {
    place.exits.forEach((exit, index) => {
      for (const key of exit.openedBy ?? []) if (!byId.has(key)) result.problems.push({ path: join(worldDir, 'locations', place.id, 'location.json'), message: `exits[${index}].opened_by: "${key}" is not an item of this world` })
    })
  }
  return result
}

/** The items in an order where each comes after the container it starts in. */
export function containersFirst(items: readonly ItemDefinition[]): ItemDefinition[] {
  const ordered: ItemDefinition[] = []
  const placed = new Set<string>()
  const byId = new Map(items.map(item => [item.id, item]))
  const place = (item: ItemDefinition): void => {
    if (placed.has(item.id)) return
    placed.add(item.id)
    const box = item.start.kind === 'inside' ? byId.get(item.start.item) : undefined
    if (box !== undefined) place(box)
    ordered.push(item)
  }
  for (const item of items) place(item)
  return ordered
}
