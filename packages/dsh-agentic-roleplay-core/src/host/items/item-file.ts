import { CONTAINER_STATES, SLOT_ID, type ItemDefinition, type Slot } from 'dsh-roleplay-model'
import { readIdentifier } from '../identifiers.ts'
import { readVariableValues } from '../variables/values.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const ITEM_FILE_NAME = 'item.json'
export const SLOTS_FILE_NAME = 'slots.json'

/** At most this many items open one lock. */
export const MAX_OPENERS = 10

/** Read an `item.json`; `fallbackId` (the folder name) is its id when the file sets none. */
export function parseItemFile(text: string, fallbackId: string): ParseResult<ItemDefinition> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const id = readIdentifier(reader, fallbackId) ?? fallbackId
  const name = reader.string('name', { required: true })
  const quantity = reader.number('quantity', { min: 1 }) ?? 1
  if (!Number.isInteger(quantity)) reader.fail('quantity', 'must be a whole number')
  const flag = (key: string): boolean => {
    const value = reader.raw(key)
    if (value !== undefined && typeof value !== 'boolean') reader.fail(key, 'must be true or false')
    return value === true
  }
  const unique = flag('unique')
  if (unique && quantity > 1) reader.fail('unique', 'a unique item is one thing: leave the quantity out')
  const wearable = reader.string('wearable')
  if (wearable !== undefined && !SLOT_ID.test(wearable)) reader.fail('wearable', 'must be the id of a slot: lowercase letters, digits, "-" or "_"')
  const box = reader.object('container')
  const container = box === undefined ? undefined : { state: box.oneOf('state', CONTAINER_STATES, 'closed'), openedBy: box.strings('opened_by') }
  if (container !== undefined && container.openedBy.length > MAX_OPENERS) box?.fail('opened_by', `at most ${MAX_OPENERS} items open one lock`)
  const owner = reader.string('owner')

  const location = reader.string('location')
  const heldBy = reader.string('held_by')
  const wornBy = reader.string('worn_by')
  const inside = reader.string('inside')
  const position = reader.string('position')
  const feature = reader.string('feature')
  const holders = [location, heldBy, wornBy, inside].filter(holder => holder !== undefined).length
  if (holders !== 1) reader.fail(holders === 0 ? 'location' : 'held_by', 'say where it starts with exactly one of location, held_by, worn_by or inside')
  if (feature !== undefined && location === undefined) reader.fail('feature', 'needs a location')
  if (wornBy !== undefined && wearable === undefined) reader.fail('worn_by', 'it is worn but not wearable: give it a wearable slot')
  const start: ItemDefinition['start'] = location !== undefined
    ? { kind: 'location', location, ...(position === undefined ? {} : { position }), ...(feature === undefined ? {} : { feature }) }
    : heldBy !== undefined ? { kind: 'held', character: heldBy }
      : wornBy !== undefined ? { kind: 'worn', character: wornBy, ...(position === undefined ? {} : { position }) }
        : { kind: 'inside', item: inside ?? '', ...(position === undefined ? {} : { position }) }

  const variables = readVariableValues(reader)
  const definition: ItemDefinition = {
    id, name: name ?? '', description: reader.text('description'), quantity, unique, quality: reader.text('quality'), notable: flag('notable'), hidden: flag('hidden'),
    ...(wearable === undefined ? {} : { wearable }), ...(container === undefined ? {} : { container }), ...(owner === undefined ? {} : { owner }), ...(variables === undefined ? {} : { variables }), start,
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: definition }
}

/** Read `slots.json`: a list of `{ id, name, capacity }` that adds to the usual slots or changes them. */
export function parseSlotsFile(text: string): ParseResult<Slot[]> {
  const issues: Issue[] = []
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/, '')) } catch (error) { return { ok: false, issues: [{ path: '', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }] } }
  if (!Array.isArray(data)) return { ok: false, issues: [{ path: '', message: 'expected a list of slots' }] }
  const slots: Slot[] = []
  data.forEach((entry: unknown, index) => {
    const at = `[${index}]`
    if (typeof entry !== 'object' || entry === null) { issues.push({ path: at, message: 'must be an object' }); return }
    const { id, name, capacity } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !SLOT_ID.test(id)) issues.push({ path: `${at}.id`, message: 'must be lowercase letters, digits, "-" or "_"' })
    if (typeof name !== 'string' || name.trim() === '') issues.push({ path: `${at}.name`, message: 'is required' })
    if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1) issues.push({ path: `${at}.capacity`, message: 'must be a whole number from 1' })
    if (typeof id === 'string' && typeof name === 'string' && typeof capacity === 'number') slots.push({ id, name: name.trim(), capacity })
  })
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: slots }
}
