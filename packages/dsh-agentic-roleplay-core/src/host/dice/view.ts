import type { DiceRoll } from 'dsh-roleplay-model'
import type { RollView } from '../../shared/narration.ts'

const sign = (value: number): string => (value >= 0 ? `+${value}` : String(value))

/** A roll as the player reads it: what it was for, what fell, what it came to and what the world's check made of it. */
export function rollView(roll: DiceRoll): RollView {
  const kept = roll.kept.length < roll.faces.length ? ` (${roll.kept.join(', ')})` : ''
  const against = roll.target === undefined ? '' : ` / ${roll.target}`
  const outcome = roll.readout === undefined ? '' : ` - ${roll.readout.label}${roll.readout.critical ? '!' : ''}`
  return { id: roll.id, by: roll.by, text: `${roll.reason}: ${roll.expression} [${roll.faces.join(', ')}]${kept}${roll.modifier === 0 ? '' : ` ${sign(roll.modifier)}`} = ${roll.total}${against}${outcome}` }
}
