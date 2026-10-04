import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ItemChangeSpec } from 'dsh-roleplay-state'
import type { NarrationSegment, TurnOutput } from '../../shared/narration.ts'

export const COMMITMENTS = ['low', 'medium', 'high'] as const
/** How hard a character will keep trying if what it intends does not work out. */
export type Commitment = typeof COMMITMENTS[number]

export const RESULTS = ['succeeded', 'partial', 'failed'] as const
/** What became of a character's intent once the game master resolved the round. */
export type Result = typeof RESULTS[number]

/** What a character answers when it is asked to act. */
export interface CharacterAction {
  /** What the character does, or tries to do. */
  intent: string
  /** What the character says aloud, word for word; absent when it stays silent. */
  utterance?: string
  commitment: Commitment
}

/** A character's action together with who gave it. `character` is the key the game master uses. */
export interface CharacterReport extends CharacterAction {
  character: string
  name: string
}

/** A character that could not act, and why. */
export interface CharacterFailure {
  character: string
  name: string
  reason: string
}

/** The game master's decision for one character in a round. */
export interface Outcome {
  character: string
  result: Result
  /** What concretely happens to the character. */
  summary: string
  /** What anyone present can now observe about the character; the stored public state is kept when absent. */
  publicState?: string
  /** Whether the character gets to say its utterance; it does unless the game master says it could not. */
  spoken?: boolean
  /** Where the character goes as a result: the key of a place, and where in it. */
  moveTo?: MoveRequest
  /** What the character does with things as a result, in order: take, drop, give, put, wear, remove, open, close, lock, unlock, reveal. */
  itemChanges?: ItemChangeSpec[]
}

/** A request to send a character somewhere, with places named by key. */
export interface MoveRequest {
  location: string
  position?: string
  /** The key of a feature of the place it ends up at. */
  feature?: string
  /** Skip the exits: the story itself carries the character. */
  ignoreExits?: boolean
}

/** An utterance that has to appear in the narration, exactly as the character gave it. */
export interface Utterance {
  character: string
  name: string
  text: string
  /** The round of the turn it was spoken in, from 1; utterances keep the order of their rounds. */
  round: number
}

export type { NarrationSegment, TurnOutput }

/** What a character is asked to produce; the sub-agent runtime enforces it. */
export const CHARACTER_ACTION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', description: 'What the character does, or tries to do, now, as an action in one or two sentences, without any speech.' },
    utterance: { type: 'string', description: 'What the character says aloud, word for word and in its own voice, exactly as it will be shown. Leave out when it says nothing.' },
    commitment: {
      type: 'string',
      enum: [...COMMITMENTS],
      description: 'How hard the character will keep trying if this does not work out: low gives up at once, high persists.',
    },
  },
  required: ['intent', 'commitment'],
  additionalProperties: false,
}

/** @throws {Error} when the value is not a character action. */
export function parseCharacterAction(value: unknown): CharacterAction {
  if (typeof value !== 'object' || value === null) throw new Error('the character did not answer with an object')
  const { intent, utterance, commitment } = value as Record<string, unknown>
  if (typeof intent !== 'string' || intent.trim() === '') throw new Error('the character gave no intent')
  if (!COMMITMENTS.includes(commitment as Commitment)) throw new Error(`the character gave an unknown commitment "${String(commitment)}"`)
  if (utterance !== undefined && typeof utterance !== 'string') throw new Error('the character\'s utterance is not text')
  const spoken = utterance?.trim()
  return { intent: intent.trim(), ...(spoken === undefined || spoken === '' ? {} : { utterance: spoken }), commitment: commitment as Commitment }
}
