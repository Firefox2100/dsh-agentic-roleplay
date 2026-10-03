import type { Character, CharacterState, CharacterStatePatch } from 'dsh-roleplay-model'
import type { ChatSettings } from '../../shared/settings.ts'
import type { CharacterAction, CharacterReport, NarrationSegment, Outcome, Utterance } from './protocol.ts'

/** A character as the turn sees it. `key` is how the game master and the tools name it. */
export interface CastMember {
  key: string
  character: Character
  state?: CharacterState
}

/** What one earlier decision of the round means to a character that reacts to it. */
export interface Reaction {
  /** The round of the turn it happened in, when it is from an earlier one. */
  round?: number
  character: string
  name: string
  intent: string
  utterance?: string
  result: Outcome['result']
  summary: string
}

export interface CharacterRequest {
  member: CastMember
  cast: readonly CastMember[]
  /** The description of the moment the game master gave. */
  situation: string
  /** 1 for the first time the characters are asked in a round, 2 for the one retry. */
  attempt: 1 | 2
  /** What happened in the earlier rounds of this turn, in order. */
  earlier?: readonly Reaction[]
  /** On the retry: what everyone's intents became in the attempt before. */
  reaction?: readonly Reaction[]
  /** On the retry: what this character itself intended before. */
  previous?: CharacterAction
}

/** What one character is told: who it is, and what it is asked. */
export interface CharacterBrief {
  persona: string
  prompt: string
}

export type Verdict = { ok: true } | { ok: false; reason: string }

/*
 * The extension points of a turn. Each one has a default in `defaults.ts`; a
 * plugin changes the behaviour of a boundary by replacing it on the
 * `roleplayOrchestration` service.
 */

/** Which characters are asked to act. */
export interface ActivationPlanner {
  /** @throws {Error} when a requested character cannot be activated. */
  plan(input: { cast: readonly CastMember[]; requested?: readonly string[] }): readonly string[]
}

/** What each character knows and is asked; the place to give characters context of their own. */
export interface CharacterContextProvider {
  brief(request: CharacterRequest): CharacterBrief
}

/** Checks a character's answer before the game master sees it. */
export interface CharacterOutputValidator {
  validate(action: CharacterAction, request: CharacterRequest): Verdict
}

/** Which characters get to act again after the first round. */
export interface RetryPolicy {
  select(round: { reports: readonly CharacterReport[]; outcomes: readonly Outcome[] }): readonly string[]
}

/** Checks what the player did before any character is asked to act. */
export interface InputValidator {
  validate(input: { text: string; turn: number; cast: readonly CastMember[] }): Verdict
}

export interface NarrationInput {
  /** What each round of the turn was about, in order. */
  situations: readonly string[]
  outcomes: readonly Outcome[]
  reports: readonly CharacterReport[]
  /** What the characters said, in order; the output must carry every one of these as it is. */
  utterances: readonly Utterance[]
}

/** Writes the output of a turn itself, or leaves it to the game master by returning nothing. */
export interface Narrator {
  narrate(input: NarrationInput): Promise<readonly NarrationSegment[] | undefined>
}

/**
 * Guards what the player is shown: every utterance a character gave must appear
 * in it unchanged, and nothing may be said that a character did not say.
 */
export interface NarrationChecker {
  /** @returns what is wrong, one problem per entry; empty when the output is acceptable. `required` is in the order spoken. */
  check(segments: readonly NarrationSegment[], required: readonly Utterance[]): string[]
  /** Corrects the output without asking anyone, when asking again did not help. */
  repair(segments: readonly NarrationSegment[], required: readonly Utterance[]): NarrationSegment[]
}

/** The state of the scene the game master is told at the start of a turn. */
export interface SceneContextProvider {
  scene(input: { cast: readonly CastMember[]; turn: number }): string
}

export interface Boundaries {
  planner: ActivationPlanner
  characterContext: CharacterContextProvider
  outputValidator: CharacterOutputValidator
  retryPolicy: RetryPolicy
  inputValidator: InputValidator
  narrator: Narrator
  narrationChecker: NarrationChecker
  sceneContext: SceneContextProvider
}

/** Where a turn reads the cast and writes what it decided. */
export interface TurnStore {
  cast(): CastMember[]
  /** What the chat's settings say now; read at each round, so a change applies at once. */
  settings(): ChatSettings
  /** Writes the updates of one round, together or not at all. */
  commit(updates: readonly { character: Character['id']; patch: CharacterStatePatch }[]): void
  /** Counts the turn as played, once its output is delivered. */
  completeTurn(): void
}
