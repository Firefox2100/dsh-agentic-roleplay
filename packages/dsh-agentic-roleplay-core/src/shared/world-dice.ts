import { DICE_COMPARISONS, DICE_READINGS, DICE_RESULTS, type DiceCheckDefinition } from 'dsh-roleplay-model'
import { InvalidEditProblems } from './world-state.ts'

/** The checks of a world as `dice.json` writes them. */
export interface DiceDocument {
  checks: DiceCheckDefinition[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const CHECK_FIELDS = ['key', 'name', 'use', 'dice', 'reading', 'hit', 'compare', 'modifier', 'bands']
const BAND_FIELDS = ['min', 'max', 'label', 'result', 'critical']

/** Reads a body that came from the browser: the shape of every field is checked here, and what the checks mean when the world is validated. */
export function parseDiceEdit(value: unknown): DiceDocument {
  const problems: string[] = []
  if (!isObject(value) || !Array.isArray(value['checks'])) throw new InvalidEditProblems(['the dice must be { checks: [...] }'])
  const checks = value['checks'].map((entry, index): DiceCheckDefinition => {
    const at = `checks[${index}]`
    const empty: DiceCheckDefinition = { key: '', name: '', use: '', dice: '', bands: [] }
    if (!isObject(entry)) { problems.push(`${at} must be an object`); return empty }
    for (const key of Object.keys(entry)) if (!CHECK_FIELDS.includes(key)) problems.push(`${at}.${key} is not a field of a check`)
    for (const key of ['key', 'name', 'use', 'dice'] as const) if (typeof entry[key] !== 'string') problems.push(`${at}.${key} must be text`)
    if (entry['reading'] !== undefined && !DICE_READINGS.includes(entry['reading'] as never)) problems.push(`${at}.reading must be one of: ${DICE_READINGS.join(', ')}`)
    if (entry['compare'] !== undefined && !DICE_COMPARISONS.includes(entry['compare'] as never)) problems.push(`${at}.compare must be one of: ${DICE_COMPARISONS.join(', ')}`)
    if (entry['hit'] !== undefined && (typeof entry['hit'] !== 'number' || !Number.isInteger(entry['hit']))) problems.push(`${at}.hit must be a whole number`)
    if (entry['modifier'] !== undefined && typeof entry['modifier'] !== 'string') problems.push(`${at}.modifier must be text`)
    const bands = Array.isArray(entry['bands']) ? entry['bands'] : undefined
    if (bands === undefined) problems.push(`${at}.bands must be a list`)
    const text = (field: unknown): string => (typeof field === 'string' ? field.trim() : '')
    const hit = entry['hit']
    return {
      key: text(entry['key']), name: text(entry['name']), use: text(entry['use']), dice: text(entry['dice']),
      ...(entry['reading'] === undefined ? {} : { reading: entry['reading'] as NonNullable<DiceCheckDefinition['reading']> }),
      ...(typeof hit === 'number' ? { hit } : {}),
      ...(entry['compare'] === undefined ? {} : { compare: entry['compare'] as NonNullable<DiceCheckDefinition['compare']> }),
      ...(text(entry['modifier']) === '' ? {} : { modifier: text(entry['modifier']) }),
      bands: (bands ?? []).map((band, bandIndex) => {
        const where = `${at}.bands[${bandIndex}]`
        if (!isObject(band)) { problems.push(`${where} must be an object`); return { label: '', result: 'failed' as const } }
        for (const key of Object.keys(band)) if (!BAND_FIELDS.includes(key)) problems.push(`${where}.${key} is not a field of a band`)
        for (const key of ['min', 'max'] as const) if (band[key] !== undefined && (typeof band[key] !== 'number' || !Number.isFinite(band[key]))) problems.push(`${where}.${key} must be a number`)
        if (typeof band['label'] !== 'string') problems.push(`${where}.label must be text`)
        if (!DICE_RESULTS.includes(band['result'] as never)) problems.push(`${where}.result must be one of: ${DICE_RESULTS.join(', ')}`)
        const min = band['min']
        const max = band['max']
        return {
          label: text(band['label']), result: band['result'] as DiceCheckDefinition['bands'][number]['result'],
          ...(typeof min === 'number' ? { min } : {}), ...(typeof max === 'number' ? { max } : {}),
          ...(band['critical'] === true ? { critical: true as const } : {}),
        }
      }),
    }
  })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return { checks }
}
