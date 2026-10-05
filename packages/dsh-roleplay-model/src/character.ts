import type { RoutineDefinition } from './agenda.ts'
import type { VariableValue } from './variable.ts'
import type { RelationshipDefinition } from './relationship.ts'
import type { CharacterStart } from './state.ts'

export const CHARACTER_ROLES = ['playable', 'npc'] as const
export const CHARACTER_TIERS = ['principal', 'supporting', 'background'] as const
export const CHARACTER_KINDS = ['person', 'group'] as const

/** Whether the player may choose the character; a world can offer several. */
export type CharacterRole = typeof CHARACTER_ROLES[number]

/**
 * How much simulation a character gets: principals act on their own,
 * supporting characters act when the scene involves them, background
 * characters only react as the world changes.
 */
export type CharacterTier = typeof CHARACTER_TIERS[number]

/** A single person, or a crowd or organisation treated as one participant. */
export type CharacterKind = typeof CHARACTER_KINDS[number]

export interface CharacterSpeech {
  style: string
  examples: string[]
}

/** A character as authored in a world. */
export interface CharacterDefinition {
  /** Provisional, unique within the world; only for links inside the exported files. */
  id: string
  name: string
  /** Nicknames and other names the character answers to. */
  aliases: string[]
  age?: string
  gender?: string
  /** May differ from the gender, for example "she/her". */
  pronouns?: string
  kind: CharacterKind
  tier: CharacterTier
  role: CharacterRole
  /** One or two sentences, for lists and previews. */
  summary: string
  personality: string
  background: string
  appearance: string
  speech: CharacterSpeech
  start: CharacterStart
  /** How this character stands towards others of the world, by their ids. */
  relationships?: RelationshipDefinition[]
  /** The recurring day of the character: what it is doing and where, by the clock. */
  routine?: RoutineDefinition[]
  /** What it starts with of what the world tracks (a value for each of the variables named), by variable key. */
  variables?: Record<string, VariableValue>
}
