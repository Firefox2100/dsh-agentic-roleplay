import { randomInt } from 'node:crypto'
import { DICE_COMPARISONS, DICE_READINGS, DICE_RESULTS, MAX_DICE_BANDS, MAX_DICE_PER_ROLL, MAX_DICE_SIDES, MAX_DICE_TERMS, type DiceBand, type DiceCheckDefinition, type DiceReadout } from 'dsh-roleplay-model'
import { InvalidValueError } from '../errors.ts'

/** A die with this many sides shows a number from 1 to `sides`. The system's own source of randomness is the default. */
export type Roller = (sides: number) => number

export const systemRoller: Roller = sides => randomInt(1, sides + 1)

type KeepMode = 'kh' | 'kl' | 'dh' | 'dl'

type Term =
  | { sign: 1 | -1; count: number; sides: number; keep?: { mode: KeepMode; n: number } }
  | { sign: 1 | -1; constant: number }

export interface Notation {
  /** The expression written the same way whatever the spacing and case. */
  text: string
  terms: Term[]
}

const TERM = /^(?:(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d*))?|(\d+))$/

/** Reads dice notation: `2d6+1`, `d20`, `4d6kh3`, `d%`, `1d8+1d4-1`. @throws {InvalidValueError} with what is wrong. */
export function parseNotation(input: string): Notation {
  const source = input.toLowerCase().replace(/\s+/g, '')
  if (source === '') throw new InvalidValueError('dice notation is empty: write it like 2d6+1')
  const parts = source.split(/(?=[+-])/)
  if (parts.length > MAX_DICE_TERMS) throw new InvalidValueError(`dice notation has more than ${MAX_DICE_TERMS} terms`)
  const terms = parts.map((part, index): Term => {
    const sign: 1 | -1 = part.startsWith('-') ? -1 : 1
    const body = part.replace(/^[+-]/, '')
    if (index > 0 && !/^[+-]/.test(part)) throw new InvalidValueError(`"${input}" is not dice notation: write it like 2d6+1`)
    const match = TERM.exec(body)
    if (match === null) throw new InvalidValueError(`"${part}" is not dice notation: write it like 2d6+1, 4d6kh3 or d100`)
    if (match[5] !== undefined) return { sign, constant: Number(match[5]) }
    const count = match[1] === '' || match[1] === undefined ? 1 : Number(match[1])
    const sides = match[2] === '%' ? 100 : Number(match[2])
    if (count < 1 || count > MAX_DICE_PER_ROLL) throw new InvalidValueError(`"${part}": roll from 1 to ${MAX_DICE_PER_ROLL} dice at a time`)
    if (sides < 2 || sides > MAX_DICE_SIDES) throw new InvalidValueError(`"${part}": a die has from 2 to ${MAX_DICE_SIDES} sides`)
    const mode = match[3] as KeepMode | undefined
    if (mode === undefined) return { sign, count, sides }
    const n = match[4] === '' || match[4] === undefined ? 1 : Number(match[4])
    if (n < 1 || n >= count) throw new InvalidValueError(`"${part}": ${mode.startsWith('k') ? 'keep' : 'drop'} at least 1 and fewer than the ${count} dice`)
    return { sign, count, sides, keep: { mode, n } }
  })
  if (!terms.some(term => 'sides' in term)) throw new InvalidValueError(`"${input}" has no dice: write it like 2d6+1`)
  return { text: source, terms }
}

/** The lowest and highest total the dice and constants can give. */
export function notationRange(notation: Notation): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const term of notation.terms) {
    if ('constant' in term) {
      min += term.sign * term.constant
      max += term.sign * term.constant
      continue
    }
    const kept = term.keep === undefined ? term.count : term.keep.mode.startsWith('k') ? term.keep.n : term.count - term.keep.n
    const low = kept
    const high = kept * term.sides
    min += term.sign === 1 ? low : -high
    max += term.sign === 1 ? high : -low
  }
  return { min, max }
}

export interface Rolled {
  /** Every die, in the order of the terms. */
  faces: number[]
  /** The dice that count. */
  kept: number[]
  /** The constants of the expression, signed. */
  constant: number
  /** The dice that count with their signs, plus the constants. */
  total: number
}

function keepOf(faces: readonly number[], keep: NonNullable<Extract<Term, { sides: number }>['keep']>): number[] {
  const ordered = faces.map((face, index) => ({ face, index })).sort((a, b) => a.face - b.face || a.index - b.index)
  const count = keep.mode.startsWith('k') ? keep.n : faces.length - keep.n
  const chosen = keep.mode === 'kh' || keep.mode === 'dl' ? ordered.slice(ordered.length - count) : ordered.slice(0, count)
  return chosen.sort((a, b) => a.index - b.index).map(entry => entry.face)
}

export function rollNotation(notation: Notation, roll: Roller = systemRoller): Rolled {
  const faces: number[] = []
  const kept: number[] = []
  let constant = 0
  let total = 0
  for (const term of notation.terms) {
    if ('constant' in term) {
      constant += term.sign * term.constant
      total += term.sign * term.constant
      continue
    }
    const thrown = Array.from({ length: term.count }, () => roll(term.sides))
    const counted = term.keep === undefined ? thrown : keepOf(thrown, term.keep)
    faces.push(...thrown)
    kept.push(...counted)
    total += term.sign * counted.reduce((sum, face) => sum + face, 0)
  }
  return { faces, kept, constant, total }
}

const within = (band: DiceBand, value: number): boolean => (band.min === undefined || value >= band.min) && (band.max === undefined || value <= band.max)

/** What the bands of a check make of a value. @throws {InvalidValueError} when no band holds it. */
export function readBands(bands: readonly DiceBand[], value: number): DiceReadout {
  const band = bands.find(candidate => within(candidate, value))
  if (band === undefined) throw new InvalidValueError(`no band of this check holds ${value}: the check's bands leave a gap`)
  return { label: band.label, result: band.result, critical: band.critical === true }
}

export interface CheckRoll {
  faces: number[]
  kept: number[]
  modifier: number
  target?: number
  total: number
  value: number
  readout: DiceReadout
}

/**
 * Rolls a check: the dice, the character's modifier and any bonus added, then the value read against the bands. With the reading
 * `successes` the total is the number of dice that hit. A check read against a target needs one.
 * @throws {InvalidValueError} for a target a check needs and is not given, or bands that leave the value unread.
 */
export function rollCheck(check: DiceCheckDefinition, input: { modifier?: number; bonus?: number; target?: number }, roll: Roller = systemRoller): CheckRoll {
  const notation = parseNotation(check.dice)
  const rolled = rollNotation(notation, roll)
  const comparison = check.compare ?? 'absolute'
  if (comparison !== 'absolute' && input.target === undefined) {
    throw new InvalidValueError(`the check "${check.key}" is read against a target (${comparison === 'over' ? 'the number to meet or beat' : 'the number to stay under'}): give one`)
  }
  const added = (input.modifier ?? 0) + (input.bonus ?? 0)
  const total = check.reading === 'successes' ? rolled.kept.filter(face => face >= (check.hit ?? 0)).length + (input.bonus ?? 0) : rolled.total + added
  const value = comparison === 'over' ? total - (input.target ?? 0) : comparison === 'under' ? (input.target ?? 0) - total : total
  return {
    faces: rolled.faces, kept: rolled.kept, modifier: check.reading === 'successes' ? (input.bonus ?? 0) : rolled.constant + added,
    ...(input.target === undefined ? {} : { target: input.target }), total, value, readout: readBands(check.bands, value),
  }
}

/** What is wrong with a check as a world defines it; nothing when it is sound. */
export function checkProblems(check: DiceCheckDefinition): string[] {
  const problems: string[] = []
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(check.key)) problems.push(`the key "${check.key}" must be lower-case letters, digits, - or _, starting with a letter`)
  if (check.name.trim() === '') problems.push('it needs a name')
  if (check.use.trim() === '') problems.push('it needs a "use": when the game master rolls it')
  if (check.compare !== undefined && !DICE_COMPARISONS.includes(check.compare)) problems.push(`"compare" must be one of: ${DICE_COMPARISONS.join(', ')}`)
  if (check.reading !== undefined && !DICE_READINGS.includes(check.reading)) problems.push(`"reading" must be one of: ${DICE_READINGS.join(', ')}`)
  let notation: Notation | undefined
  try { notation = parseNotation(check.dice) } catch (error) { problems.push(`"dice": ${error instanceof Error ? error.message : String(error)}`) }
  if (check.bands.length === 0) problems.push('it needs at least one band')
  if (check.bands.length > MAX_DICE_BANDS) problems.push(`it has more than ${MAX_DICE_BANDS} bands`)
  check.bands.forEach((band, index) => {
    if (band.label.trim() === '') problems.push(`band ${index + 1} needs a label`)
    if (!DICE_RESULTS.includes(band.result)) problems.push(`band ${index + 1}: "result" must be one of: ${DICE_RESULTS.join(', ')}`)
    if (band.min !== undefined && band.max !== undefined && band.min > band.max) problems.push(`band ${index + 1}: min is above max`)
  })
  if (check.reading === 'successes') {
    const sides = notation?.terms.flatMap(term => ('sides' in term ? [term.sides] : [])) ?? []
    if (check.hit === undefined || !Number.isInteger(check.hit) || check.hit < 1 || (sides.length > 0 && check.hit > Math.max(...sides))) problems.push('the reading "successes" needs "hit": the lowest face that counts')
  }
  if (notation !== undefined && problems.length === 0 && (check.compare ?? 'absolute') === 'absolute' && check.modifier === undefined) {
    const { min, max } = check.reading === 'successes' ? { min: 0, max: notation.terms.reduce((sum, term) => sum + ('count' in term ? term.count : 0), 0) } : notationRange(notation)
    for (let value = min; value <= max; value += 1) {
      if (!check.bands.some(band => within(band, value))) {
        problems.push(`no band holds ${value}, which the dice can give`)
        break
      }
    }
  }
  return problems
}

/** A roll of dice with no meaning attached, for what the world has no check for. */
export interface PlainRoll {
  expression: string
  faces: number[]
  kept: number[]
  modifier: number
  total: number
}

export function rollPlain(expression: string, roll: Roller = systemRoller): PlainRoll {
  const notation = parseNotation(expression)
  const rolled = rollNotation(notation, roll)
  return { expression: notation.text, faces: rolled.faces, kept: rolled.kept, modifier: rolled.constant, total: rolled.total }
}
