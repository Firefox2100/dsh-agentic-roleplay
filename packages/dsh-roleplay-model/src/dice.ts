export type DiceCheckId = number
export type DiceRollId = number

/** What a band of a check makes of an attempt; the same three results a round's outcome has. */
export const DICE_RESULTS = ['succeeded', 'partial', 'failed'] as const
export type DiceResult = (typeof DICE_RESULTS)[number]

/** How a roll is read: by its total, or by how many of the dice came up high enough. */
export const DICE_READINGS = ['total', 'successes'] as const
export type DiceReading = (typeof DICE_READINGS)[number]

/**
 * What the value is compared with: `absolute` reads the value itself, `over` the amount by which it beats the target
 * (a difficulty to meet or exceed), `under` the amount by which it stays below the target (a skill to roll under).
 */
export const DICE_COMPARISONS = ['absolute', 'over', 'under'] as const
export type DiceComparison = (typeof DICE_COMPARISONS)[number]

/** One range of values and what it means; a range left open at an end runs on for ever. */
export interface DiceBand {
  min?: number
  max?: number
  /** What it is called in play ("critical failure", "success at a cost"). */
  label: string
  result: DiceResult
  /** A result that is more than the plain one: a critical. */
  critical?: boolean
}

/** A way of settling an attempt, as a world defines it; the dice and the reading of what they show are the world's, not the model's. */
export interface DiceCheckDefinition {
  key: string
  name: string
  /** When the game master uses this check, in the author's words. */
  use: string
  /** Dice notation: `1d20`, `2d6`, `4d6kh3`, `d100`. */
  dice: string
  reading?: DiceReading
  /** With the reading `successes`: a die counts when it shows at least this. */
  hit?: number
  compare?: DiceComparison
  /** The key of a variable of the acting character that is added to the total. */
  modifier?: string
  bands: DiceBand[]
}

export interface DiceCheck extends DiceCheckDefinition {
  id: DiceCheckId
}

/** What the dice and the reading of them gave, once a roll is made. */
export interface DiceReadout {
  label: string
  result: DiceResult
  critical: boolean
}

export interface NewDiceRoll {
  turn: number
  /** The check that was rolled, none for a plain roll. */
  check?: string
  expression: string
  /** Every die rolled, in order. */
  faces: number[]
  /** The dice that count, after any are dropped or only the best are kept. */
  kept: number[]
  /** What is added to the dice: constants of the expression, the character's modifier, a bonus. */
  modifier: number
  target?: number
  /** What the dice and the modifier add up to, or the number of dice that hit. */
  total: number
  /** What the bands were compared with: the total, or its distance from the target. */
  value: number
  readout?: DiceReadout
  reason: string
  /** The character the roll was for, by key. */
  character?: string
  /** Who asked for it. */
  by: 'agent' | 'player'
}

export interface DiceRoll extends NewDiceRoll {
  id: DiceRollId
  at: string
}

/** Rolls and checks are limited so that a story cannot grow without bound. */
export const MAX_DICE_CHECKS = 40
export const MAX_DICE_BANDS = 20
export const MAX_DICE_PER_ROLL = 100
export const MAX_DICE_SIDES = 1000
export const MAX_DICE_TERMS = 8
