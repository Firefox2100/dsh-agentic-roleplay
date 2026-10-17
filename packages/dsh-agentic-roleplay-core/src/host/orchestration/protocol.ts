import { estimateAnswer } from '../agents/budget.ts'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ItemChangeSpec, VariableChangeSpec } from '@dsh-agentic-roleplay/state'
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
  /** Asked only when the character acts away from the player: one line of what happened, as someone told of it afterwards would say it. */
  account?: string
}

/** A character's action together with who gave it. `character` is the key the game master uses. */
export interface CharacterReport extends CharacterAction {
  character: string
  name: string
  /** The player's out-of-character command decreed it: the character did not choose it. */
  forced?: true
}

/**
 * A character that could not act, and why. A `technical` failure is a fault of the system (the model failed, ran out of calls, was cut off), not an event of the story: the game master
 * is not told the reason, so that it cannot be written into the story, and nothing is recorded for the character.
 */
export interface CharacterFailure {
  character: string
  name: string
  reason: string
  technical?: true
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
  /** What it changes of what the story tracks: a feeling, a health, a flag. */
  variableChanges?: VariableChangeSpec[]
  /** The id of the dice roll that decided it: the result is the one the roll gave. */
  roll?: number
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

const MAX_ACCOUNT = 300

/**
 * How long, in characters, each text of a character's answer is asked to run to: the instructions state these, and the most a character's request may produce is estimated from them.
 * A character of a script written without spaces says more in fewer.
 */
export const ANSWER_LIMITS = {
  en: { thought: 240, intent: 300, utterance: 600, account: MAX_ACCOUNT },
  zh: { thought: 100, intent: 120, utterance: 240, account: 120 },
} as const

export const answerLimits = (language: string): (typeof ANSWER_LIMITS)[keyof typeof ANSWER_LIMITS] => (language.toLowerCase().startsWith('zh') ? ANSWER_LIMITS.zh : ANSWER_LIMITS.en)

/** What the answer of a character comes to at most, in tokens (an answer about what happened out of sight has its account too). */
export function answerEstimate(language: string, away: boolean): number {
  const limits = answerLimits(language)
  return estimateAnswer([limits.thought, limits.intent, limits.utterance, ...(away ? [limits.account] : [])], language)
}

/**
 * What a character is asked to produce; the sub-agent runtime enforces it. The order is the order of what depends on what: the thought comes first so that the
 * choice that follows is made after it, which an engine that does not write fields in order simply does without (it is optional and read by no one).
 */
export const CHARACTER_ACTION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'First, in your own voice and a sentence or two: what you notice in the moment and what you want from it. No one is shown it.' },
    intent: { type: 'string', description: 'What the character does, or tries to do, now, as an action in one or two sentences, without any speech.' },
    utterance: { type: 'string', description: 'What the character says aloud, word for word and in its own voice, exactly as it will be shown. Leave out when it says nothing.' },
    commitment: {
      type: 'string',
      enum: [...COMMITMENTS],
      description: 'How hard the character will keep trying if this does not work out: low gives up at once, high persists.',
    },
  },
  required: ['thought', 'intent', 'commitment'],
  additionalProperties: false,
}

/** The schema for a character acting away from the player: the same answer, which also says in a line what happened, so no second request is needed. */
export const AWAY_ACTION_SCHEMA: ObjectJsonSchema = {
  ...CHARACTER_ACTION_SCHEMA,
  properties: {
    ...CHARACTER_ACTION_SCHEMA.properties,
    account: { type: 'string', description: 'One sentence, in the third person and the past tense, of what came of this, as someone who only saw it from outside would tell it afterwards: no thoughts, no secrets.' },
  },
  required: ['thought', 'intent', 'commitment', 'account'],
}


/** @throws {Error} when the value is not a character action. */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』'], ['«', '»'], ['‘', '’']]

/** Words said aloud, without the quotation marks a model puts around them: the output puts its own. */
export function unquoted(text: string): string {
  let words = text.trim()
  for (let again = true; again;) {
    again = false
    for (const [open, close] of QUOTE_PAIRS) {
      if (words.length >= 2 && words.startsWith(open) && words.endsWith(close) && !words.slice(open.length, -close.length).includes(close)) { words = words.slice(open.length, words.length - close.length).trim(); again = true }
    }
  }
  return words
}

const LEAKED_FIELD = /<\/?(?:intent|parameter(?:=\w+)?)>/g

/** A model that writes the markup of its call into a field puts the next field's text inside this one. */
function splitLeakedFields(intent: string): { intent: string; utterance?: string } {
  const at = intent.search(/<parameter=utterance>/)
  if (at === -1) return { intent: intent.replace(LEAKED_FIELD, ' ') }
  const spoken = intent.slice(at).replace(LEAKED_FIELD, ' ').trim()
  return { intent: intent.slice(0, at).replace(LEAKED_FIELD, ' '), ...(spoken === '' ? {} : { utterance: spoken }) }
}

export function parseCharacterAction(value: unknown): CharacterAction {
  if (typeof value !== 'object' || value === null) throw new Error('the character did not answer with an object')
  const { intent: rawIntent, utterance: rawUtterance, commitment, account } = value as Record<string, unknown>
  const { intent, utterance } = typeof rawIntent === 'string' && rawUtterance === undefined ? splitLeakedFields(rawIntent) : { intent: rawIntent, utterance: rawUtterance }
  if (typeof intent !== 'string' || intent.trim() === '') throw new Error('the character gave no intent')
  if (!COMMITMENTS.includes(commitment as Commitment)) throw new Error(`the character gave an unknown commitment "${String(commitment)}"`)
  if (utterance !== undefined && typeof utterance !== 'string') throw new Error('the character\'s utterance is not text')
  const spoken = utterance === undefined ? undefined : unquoted(utterance)
  const told = typeof account === 'string' ? account.trim().slice(0, MAX_ACCOUNT) : ''
  return { intent: intent.trim(), ...(spoken === undefined || spoken === '' ? {} : { utterance: spoken }), commitment: commitment as Commitment, ...(told === '' ? {} : { account: told }) }
}
