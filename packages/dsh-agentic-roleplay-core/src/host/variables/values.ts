import type { VariableValue } from 'dsh-roleplay-model'
import type { Reader } from '../validation.ts'

/** At most this many initial values in one file. */
const MAX_VALUES = 40

/** The `variables` of a world file: what a character, item, place or the world starts with, by the key of each variable. */
export function readVariableValues(reader: Reader): Record<string, VariableValue> | undefined {
  const value = reader.raw('variables')
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    reader.fail('variables', 'must be an object of values by variable key')
    return undefined
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_VALUES) reader.fail('variables', `at most ${MAX_VALUES} values`)
  const values: Record<string, VariableValue> = {}
  for (const [key, entry] of entries) {
    if (typeof entry === 'number' && Number.isFinite(entry) || typeof entry === 'boolean' || typeof entry === 'string') values[key] = entry
    else reader.fail(`variables.${key}`, 'must be a number, true or false, or text')
  }
  return values
}
