import type { CharacterDefinition } from './character.ts'
import type { EmotionStart } from './emotion.ts'
import type { JsonValue } from './json.ts'
import type { CharacterStart } from './state.ts'
import type { Intent } from './intent.ts'

export const CHARACTER_CONTROLS = ['player', 'agent'] as const

export type CharacterId = number
export type IntentId = number

/** Who decides what a character does in a session. */
export type CharacterControl = typeof CHARACTER_CONTROLS[number]

/**
 * Where a session's world came from. The session keeps no copy of the world,
 * so this is only a reference; further provenance can go in `extra` without a
 * schema change.
 */
export interface WorldReference {
  /** The world's stable id, kept in its `world.json`; not a database id. */
  id: string
  name: string
  version?: string
  /** Identifies the exact world content the session was started from. */
  fingerprint?: string
  source?: string
  extra?: Record<string, JsonValue>
}

export interface NewSession {
  /** Also the name of the session's folder. */
  id: string
  /** What the player calls the session; usually starts as the world's name. */
  name: string
  world: WorldReference
}

export interface SessionMetadata extends NewSession {
  createdAt: string
  /** When the last turn was played; absent for a session that has not been played yet. */
  lastPlayedAt?: string
  /** Turns played so far. */
  turns: number
}

/** A character in a session: the definition without its start state, under a session-local id. */
export interface Character extends Omit<CharacterDefinition, 'id' | 'start'> {
  id: CharacterId
  /** The character's provisional id in the world it came from; absent when created during play. */
  sourceId?: string
  control: CharacterControl
  createdAt: string
}

export type NewCharacter = Omit<Character, 'id' | 'createdAt'>

export interface CharacterFilter {
  role?: Character['role']
  tier?: Character['tier']
  kind?: Character['kind']
  control?: CharacterControl
}

/** A character's current state; it starts as the world's `start` block and changes during play. */
export interface CharacterState extends Omit<CharacterStart, 'intents'> {
  characterId: CharacterId
  /** Increases with every change, for detecting conflicting updates. */
  version: number
  updatedAt: string
}

export type NewCharacterState = Omit<CharacterStart, 'intents'>

/** Fields left out stay as they are; `null` removes the emotion. */
export interface CharacterStatePatch {
  publicState?: string
  innerState?: string
  activity?: string
  emotion?: EmotionStart | null
}

export interface CharacterIntent extends Intent {
  id: IntentId
  characterId: CharacterId
  createdAt: string
  updatedAt: string
}

/** Fields left out stay as they are; `null` removes the deadline. */
export type IntentPatch = Partial<Omit<Intent, 'deadline'>> & { deadline?: string | null }

export interface IntentFilter {
  status?: Intent['status']
}
