import type { Character, CharacterState, CharacterStatePatch } from 'dsh-roleplay-model'
import type { MemoryPolicy, Recalled, Session } from 'dsh-roleplay-state'
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
  /** The turn being played. */
  turn: number
  /** What the moment reminds this character of, as it comes back to it. */
  memories?: readonly Recalled[]
  /** Whether the character can ask itself about more of what it remembers, while it decides. */
  lookup: boolean
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

/** What one character did in a recorded round and how it turned out. */
export interface CommitEntry {
  character: string
  name: string
  intent: string
  utterance?: string
  commitment: CharacterReport['commitment']
  result: Outcome['result']
  summary: string
  publicState?: string
  /** Whether the character got to say its utterance. */
  spoken: boolean
}

/** One recorded round, as it is kept until its records are written. */
export interface RoundRecord {
  turn: number
  round: number
  /** What the round was about, including what the player's character did. */
  situation: string
  entries: CommitEntry[]
}

/** Every recorded round whose records are not written yet, oldest first: normally one, more when an earlier attempt failed. */
export interface CommitJob {
  chat: string
  rounds: readonly RoundRecord[]
  store: TurnStore
}

export interface CommitReport {
  /** How many records were written. */
  writes: number
  notes: string
}

/**
 * Writes what a recorded round changed into the story's records, while the output of
 * the turn is being written. It may check its own work; it throws when it cannot
 * leave the records right, which holds the turn back.
 */
export interface Committer {
  commit(job: CommitJob, signal: AbortSignal): Promise<CommitReport>
}

/**
 * Chooses what a character is reminded of when it acts. The default asks the story's records
 * (cues, importance and fading memory, and the ranking by meaning when a plugin supplies one
 * through `roleplayState.rankMemories`); replace it to recall in another way altogether.
 */
export interface Recaller {
  recall(query: { member: CastMember; situation: string; turn: number; policy: MemoryPolicy }, story: TurnStore['story'], signal: AbortSignal): Promise<Recalled[]>
}

/** The state of the scene the game master is told at the start of a turn. */
export interface SceneContextProvider {
  scene(input: { cast: readonly CastMember[]; turn: number; /** What the player just did or said. */ input: string; story: TurnStore['story'] }): string
}

export interface Boundaries {
  planner: ActivationPlanner
  characterContext: CharacterContextProvider
  outputValidator: CharacterOutputValidator
  retryPolicy: RetryPolicy
  inputValidator: InputValidator
  narrator: Narrator
  narrationChecker: NarrationChecker
  committer: Committer
  recaller: Recaller
  sceneContext: SceneContextProvider
}

/** Where a turn reads the cast and writes what it decided. */
export interface TurnStore {
  /** What the story has recorded: events, what characters know, threads and summaries. */
  readonly story: Pick<Session, 'characters' | 'events' | 'memories' | 'threads' | 'summaries' | 'recallRanked' | 'edit' | 'records'>
  cast(): CastMember[]
  /** What the chat's settings say now; read at each round, so a change applies at once. */
  settings(): ChatSettings
  /** Writes the updates of one round, together or not at all. */
  commit(updates: readonly { character: Character['id']; patch: CharacterStatePatch }[]): void
  /** Counts the turn as played, once its output is delivered. */
  completeTurn(): void
  /** Keeps a recorded round until its records are written, so that a failure loses nothing. */
  queueCommit(record: RoundRecord): void
  /** The rounds waiting for their records to be written, oldest first. */
  pendingCommits(): RoundRecord[]
  /** Forgets rounds whose records are written. */
  completeCommits(rounds: readonly { turn: number; round: number }[]): void
}
