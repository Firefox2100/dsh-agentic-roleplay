import type { Character, CharacterState, CharacterStatePatch, Exit, Location, LocationFeature, Move, MovePlan } from 'dsh-roleplay-model'
import type { MemoryPolicy, Recalled, Session } from 'dsh-roleplay-state'
import type { ChatSettings } from '../../shared/settings.ts'
import type { CharacterAction, CharacterReport, MoveRequest, NarrationSegment, Outcome, Utterance } from './protocol.ts'

/** A character as the turn sees it. `key` is how the game master and the tools name it. */
export interface CastMember {
  key: string
  character: Character
  state?: CharacterState
  /** Where it stands; absent while it is nowhere (a world without places, or a character not placed yet). */
  place?: CastPlace
}

export interface CastPlace {
  location: Location
  /** Where in the place, in words. */
  position: string
  feature?: LocationFeature
}

/** A place as it is told to someone in it: what it is like, the ways out, and who is there. */
export interface PlaceView {
  /** The key the game master and the tools name it by. */
  key: string
  location: Location
  exits: { key: string; name: string; exit: Exit }[]
  here: CastMember[]
}

/** A short reference to a place in what is kept of a round. */
export interface PlaceRef {
  key: string
  name: string
}

/** Whether a character may go where the game master sent it, and what that comes to. */
export type MoveCheck = { ok: true; move: Move; plan: MovePlan; to: PlaceRef; position?: string } | { ok: false; problems: string[] }

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
  /** The place the character is in, when it is in one: the scene it is told is this place and who is here. */
  place?: PlaceView
  /** How the character stands towards those it is with, where there is a profile of them. */
  relationships?: readonly KnownRelationship[]
}

/** A character's profile of someone present, as it is told to it. */
export interface KnownRelationship {
  name: string
  label: string
  summary: string
  familiarity: number
  trust: number
  affinity: number
  tension: number
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
  /** Where the character was when it acted. */
  at?: PlaceRef
  /** Where the game master sent it as a result. */
  moved?: PlaceRef & { position?: string }
}

/** One recorded round, as it is kept until its records are written. */
export interface RoundRecord {
  turn: number
  round: number
  /** What the round was about, including what the player's character did. */
  situation: string
  /** Where the moment happened: the place of the player's character when the round began. */
  place?: PlaceRef
  entries: CommitEntry[]
}

/** Every recorded round whose records are not written yet, oldest first: normally one, more when an earlier attempt failed. */
export interface CommitJob {
  chat: string
  rounds: readonly RoundRecord[]
  store: TurnStore
  /** What the game master said is worth keeping, when it asked for the records to be written. */
  focus?: readonly string[]
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
  recall(query: { member: CastMember; situation: string; turn: number; policy: MemoryPolicy; /** The vector of the situation, when stored vectors exist to compare it with. */ queryVector?: readonly number[] }, story: TurnStore['story'], signal: AbortSignal): Promise<Recalled[]>
}

/** The state of the scene the game master is told at the start of a turn. */
export interface SceneContextProvider {
  scene(input: { cast: readonly CastMember[]; turn: number; /** What the player just did or said. */ input: string; /** Its vector, when stored vectors exist to compare with. */ queryVector?: readonly number[]; story: TurnStore['story'] }): string
}

/** Why the game master may ask for something to be made up: the story genuinely needs it. */
export const AUTHORING_NEEDS = ['scene_change', 'arrival', 'introduction'] as const
export type AuthoringNeed = (typeof AUTHORING_NEEDS)[number]

export interface CreateJob {
  chat: string
  turn: number
  need: AuthoringNeed
  /** What the game master says is needed, from what the story has established. */
  what: string
  store: TurnStore
}

export interface CreateReport {
  /** What was made, by key. */
  created: { kind: 'character' | 'place'; key: string; name: string }[]
  /** Why nothing was made, when nothing was: the request did not meet the bar, or something that exists can serve. */
  declined?: string
}

export interface ConsolidateJob {
  chat: string
  turn: number
  store: TurnStore
}

export interface ConsolidateReport {
  /** How many things were fitted in. */
  resolved: number
  notes: string
}

/**
 * Extends the world when the story genuinely needs it, and later fits what was made up into the rest of
 * it: places connected to their neighbours, characters given relationships. It throws when it cannot
 * leave the world consistent; what was made stays queued until it can be fitted in.
 */
export interface Author {
  create(job: CreateJob, signal: AbortSignal): Promise<CreateReport>
  consolidate(job: ConsolidateJob, signal: AbortSignal): Promise<ConsolidateReport>
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
  author: Author
  recaller: Recaller
  sceneContext: SceneContextProvider
}

/** Where a turn reads the cast and writes what it decided. */
export interface TurnStore {
  /** What the story has recorded: events, what characters know, threads and summaries. */
  readonly story: Pick<Session, 'characters' | 'events' | 'memories' | 'threads' | 'summaries' | 'recallRanked' | 'searchEvents' | 'edit' | 'records' | 'locations' | 'placements' | 'relationships' | 'consolidation' | 'planMove'>
  cast(): CastMember[]
  /** What the chat's settings say now; read at each round, so a change applies at once. */
  settings(): ChatSettings
  /** Writes the updates of one round, moves included, together or not at all. */
  commit(updates: readonly { character: Character['id']; patch: CharacterStatePatch; move?: Move }[]): void
  /** Whether a character may go where a request says (places by key), resolved to what the move would be. */
  checkMove(character: string, request: MoveRequest): MoveCheck
  /** A place as it is told to someone in it, or nothing for an id that is not one. */
  place(locationId: Location['id']): PlaceView | undefined
  /** Counts the turn as played, once its output is delivered. */
  completeTurn(): void
  /** Keeps a recorded round until its records are written, so that a failure loses nothing. */
  queueCommit(record: RoundRecord): void
  /** The rounds waiting for their records to be written, oldest first. */
  pendingCommits(): RoundRecord[]
  /** Forgets rounds whose records are written, and makes the events written for them final. */
  completeCommits(rounds: readonly { turn: number; round: number }[]): void
  /**
   * The vector of a text of the moment, to search the story's stored vectors with; `undefined` when
   * there is nothing to compare with, and a search then goes by words alone.
   */
  queryVector(text: string, signal?: AbortSignal): Promise<readonly number[] | undefined>
}
