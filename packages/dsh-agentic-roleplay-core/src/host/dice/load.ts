import { join } from 'node:path'
import { DICE_COMPARISONS, DICE_READINGS, DICE_RESULTS, MAX_DICE_CHECKS, type DiceBand, type DiceCheckDefinition } from 'dsh-roleplay-model'
import { checkProblems } from '@dsh-agentic-roleplay/state'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const DICE_FILE_NAME = 'dice.json'

function readBand(band: Reader): DiceBand | undefined {
  const label = band.string('label', { required: true })
  const result = band.oneOf('result', DICE_RESULTS, 'failed')
  const min = band.number('min')
  const max = band.number('max')
  const critical = band.raw('critical')
  if (critical !== undefined && critical !== null && typeof critical !== 'boolean') band.fail('critical', 'must be true or false')
  if (band.raw('result') === undefined) band.fail('result', `is required: one of ${DICE_RESULTS.join(', ')}`)
  return label === undefined ? undefined : { label, result, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(critical === true ? { critical: true } : {}) }
}

/**
 * Read `dice.json`: the checks a world settles uncertain attempts with (docs/world-format.md). The dice and how their result is read are the world's:
 * the game master rolls a check and is told the band the roll fell in, never a number to interpret.
 */
export function parseDiceFile(text: string): ParseResult<DiceCheckDefinition[]> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const checks = reader.objects('checks').flatMap((entry): DiceCheckDefinition[] => {
    const key = entry.string('key', { required: true })
    const name = entry.string('name', { required: true })
    const use = entry.string('use', { required: true })
    const dice = entry.string('dice', { required: true })
    const reading = entry.oneOf('reading', DICE_READINGS, 'total')
    const compare = entry.oneOf('compare', DICE_COMPARISONS, 'absolute')
    const hit = entry.number('hit', { min: 1 })
    const modifier = entry.string('modifier')
    const bands = entry.objects('bands').flatMap(band => { const read = readBand(band); return read === undefined ? [] : [read] })
    if (key === undefined || name === undefined || use === undefined || dice === undefined) return []
    const definition: DiceCheckDefinition = { key, name, use, dice, reading, compare, bands, ...(hit === undefined ? {} : { hit }), ...(modifier === undefined || modifier === '' ? {} : { modifier }) }
    for (const problem of checkProblems(definition)) entry.fail('', problem)
    return [definition]
  })
  const seen = new Set<string>()
  for (const check of checks) {
    if (seen.has(check.key)) reader.fail('checks', `the key "${check.key}" is used by more than one check`)
    seen.add(check.key)
  }
  if (checks.length > MAX_DICE_CHECKS) reader.fail('checks', `a world has at most ${MAX_DICE_CHECKS} checks`)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: checks }
}

/** The checks of a world: an optional `<world>/dice.json`; a world without one has none, and its game master rolls plain dice only. */
export async function loadDice(worldDir: string): Promise<{ checks: DiceCheckDefinition[]; problems: WorldProblem[] }> {
  const result: { checks: DiceCheckDefinition[]; problems: WorldProblem[] } = { checks: [], problems: [] }
  const file = join(worldDir, DICE_FILE_NAME)
  try {
    result.checks = (await readDocument(file, parseDiceFile, result.problems)) ?? []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}
