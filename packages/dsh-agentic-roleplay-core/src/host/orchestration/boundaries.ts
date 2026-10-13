import type { Character, CharacterState, CharacterStatePatch, Exit, Location, LocationFeature, Move, MovePlan } from 'dsh-roleplay-model'
import type { ItemChangeSpec, ItemEffect, MemoryPolicy, Recalled, Session, VariableChangeSpec, VariableEffect } from '@dsh-agentic-roleplay/state'
import type { ActivityEntry, RunDetail } from '../../shared/activity.ts'
import type { Note } from '../../shared/notes.ts'
import type { ChatSettings } from '../../shared/settings.ts'
import type { AgendaView, RoutineMove, SceneAgenda } from '../clock/agenda.ts'
import type { OffSceneItem } from '../clock/offscene.ts'
import type { SkipRequest, StoryTime } from '../clock/story-clock.ts'
import type { CharacterAction, CharacterReport, MoveRequest, NarrationSegment, Outcome, TurnOutput, Utterance } from './protocol.ts'

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
  /** What lies in the place, notable things first (hidden ones are not for the characters). */
  items?: ItemView[]
}

/** A thing as someone in a place or with a character is told of it. */
export interface ItemView {
  key: string
  name: string
  quantity: number
  quality: string
  notable: boolean
  hidden: boolean
  /** Of a container: how it is, and what is in it when it is open. */
  state?: string
  contents?: string[]
  /** Where in the place it is, or how it is carried. */
  where?: string
}

/** The durable entities a character can identify beyond what is visible in the present scene. */
export interface KnowledgeView {
  characters: string[]
  factions: string[]
  locations: string[]
  items: string[]
  routes: string[]
}

export interface FactionAffiliationView {
  name: string
  role: string
  rank: string
  status: string
  commitment: number
  publicState: string
  goals: string[]
  relationship?: KnownRelationship
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
  /** The character acts away from the player, and its answer also says in a line what came of it. */
  away?: true
  /** What the moment reminds this character of, as it comes back to it. */
  memories?: readonly Recalled[]
  /** Whether the character can ask itself about more of what it remembers, while it decides. */
  lookup: boolean
  /** An instruction text in the language of the chat. */
  text: TurnStore['text']
  /** The place the character is in, when it is in one: the scene it is told is this place and who is here. */
  place?: PlaceView
  /** How the character stands towards people who bear on the moment, where there is a profile of them. */
  relationships?: readonly KnownRelationship[]
  /** Entities this character knows exist; absent entities are unknown. */
  knowledge?: KnowledgeView
  /** Organisations this character belongs to, including memberships hidden from others. */
  affiliations?: readonly FactionAffiliationView[]
  /** What the character has on it or in its hands. */
  carrying?: readonly ItemView[]
  /** What time it is in the story. */
  time?: StoryTime
  /** What its day has it doing, what it committed to, and what it is after. */
  agenda?: AgendaView
  /** What the world made it notice just now. */
  cues?: readonly string[]
  /** What it knows is coming, soonest first. */
  upcoming?: readonly { text: string; when?: string }[]
  /** What is tracked of the character that it can tell (its feelings and whatever else is its own or public), and what it can tell of those here. */
  tracked?: { self: string; others: { name: string; text: string }[] }
}

/** A character's profile of someone present, as it is told to it. */
export interface KnownRelationship {
  name: string
  label: string
  summary: string
  /** Whether the other character is physically present. */
  present: boolean
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

/** What the player has just read, and who they are in it: all a suggestion may be based on. */
export interface SuggestionJob {
  chat: string
  turn: number
  store: TurnStore
  /** How many suggestions the chat asks for. */
  count: number
  /** The output of the turn as the player read it. */
  output: TurnOutput
}

/** Offers the player what their character could do next, after the output of a turn is delivered. */
export interface Suggester {
  /** @returns exactly `job.count` short first-person lines, or none when the chat has nobody to make them. */
  suggest(job: SuggestionJob, signal: AbortSignal): Promise<string[]>
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
  /** What the game master changed of what is tracked because of it, and what came of each. */
  variables?: { subject: string; name: string; from: string; to: string }[]
  /** What it did with things, and what came of each. */
  items?: { name: string; action: string; summary: string }[]
  /** The player's character: it was not asked to act, so `intent` is what the game master decided it did. */
  player?: true
  /** Decreed by the player's out-of-character command: the character did not choose it, `intent` is what the game master decreed it did. */
  forced?: true
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
  /** A round of characters away from the player's character, asked after the turn what they do about something that fell due: only they perceive it. */
  offstage?: true
  /** When the round began and ended in the story (UTC milliseconds), and the zone they are read in. */
  time?: { from: number; to: number; zone: string }
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
  recall(query: { member: CastMember; situation: string; turn: number; policy: MemoryPolicy; /** The vector of the situation, when stored vectors exist to compare it with. */ queryVector?: readonly number[]; /** Whether to say why each thing came back (`Recalled.why`). */ explain?: boolean }, story: TurnStore['story'], signal: AbortSignal): Promise<Recalled[]>
}

/** The state of the scene the game master is told at the start of a turn. */
export interface SceneContextProvider {
  scene(input: { /** What the story keeps track of, as lines. */ tracked?: readonly string[]; /** What time it is, and how long the story went on without the player when time follows the wall clock; and what the days of the characters say. */ time?: { now: StoryTime; away?: number; agenda?: SceneAgenda }; /** What the world did since the last turn, and what the game master has still to weave in; and what is known beforehand of what is coming. */ world?: { happened: string[]; beats: { id: number; text: string }[]; upcoming?: { text: string; who: string; when?: string }[] }; cast: readonly CastMember[]; turn: number; /** What the player just did or said. */ input: string; /** Its vector, when stored vectors exist to compare with. */ queryVector?: readonly number[]; story: TurnStore['story']; /** What is where, for the scene. */ items?: SceneItems }): string
}

export interface SceneItems {
  /** What lies in a place (hidden things too: the story knows them). */
  at: (locationId: Location['id']) => ItemView[]
  carried: (characterId: Character['id']) => ItemView[]
}

/** Why the game master may ask for something to be made up: the story genuinely needs it. */
export const AUTHORING_NEEDS = ['scene_change', 'arrival', 'introduction', 'object', 'variable', 'trigger'] as const
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
  created: { kind: 'character' | 'place' | 'item' | 'variable' | 'trigger'; key: string; name: string }[]
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

export interface StrategyJob {
  chat: string
  turn: number
  store: TurnStore
}

export interface StrategyReport {
  /** What the organisations did, one sentence each, by name. */
  acted: { faction: string; summary: string }[]
}

/**
 * Lets organisations act on their own as story time passes: after a turn, a few whose time has come decide what they do, and their
 * state, goals and a record of it are written. Nothing a faction does decides what a character does.
 */
export interface Strategist {
  strategize(job: StrategyJob, signal: AbortSignal): Promise<StrategyReport>
}

export interface JudgeJob {
  chat: string
  turn: number
  store: TurnStore
}

/** Says, after a turn, whether the statements that triggers wait on hold in the story now; the verdicts are what such a trigger reads. */
export interface TriggerJudge {
  judge(job: JudgeJob, signal: AbortSignal): Promise<{ judged: number }>
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
  strategist: Strategist
  judge: TriggerJudge
  suggester: Suggester
  recaller: Recaller
  sceneContext: SceneContextProvider
}

/** What triggers did the last time some fired, as the game master is told. */
export interface TriggerReport {
  fired: {
    name: string
    /** The events the world made happen, as text. */
    events: string[]
    /** What characters were made to notice, they will be told it the next time they act. */
    cues: { names: string[]; text: string }[]
    /** What the game master is to weave in; it says it did with the id in `narrate`. */
    beats: { id: number; text: string }[]
  }[]
}

/** Where a turn reads the cast and writes what it decided. */
export interface TurnStore {
  /** What the story has recorded: events, what characters know, threads and summaries. */
  readonly story: Pick<Session, 'metadata' | 'characters' | 'factions' | 'factionStates' | 'factionMemberships' | 'factionRelationships' | 'factionIntents' | 'lore' | 'events' | 'memories' | 'threads' | 'summaries' | 'recallRanked' | 'searchEvents' | 'edit' | 'records' | 'locations' | 'placements' | 'relationships' | 'knowledge' | 'consolidation' | 'planMove' | 'planKnownMove' | 'items' | 'slots' | 'intents' | 'routines' | 'engagements' | 'clock' | 'variables' | 'triggers' | 'transaction'>
  cast(): CastMember[]
  /** What the chat's settings say now; read at each round, so a change applies at once. */
  settings(): ChatSettings
  /** An instruction text in the language of the chat. */
  text(id: string, variables?: Readonly<Record<string, string | number>>): string
  /** What is not allowed in the story: the world's rules and the player's own. */
  rules(): string[]
  /** What time it is in the story. */
  time(turn: number): StoryTime
  /** The start of a turn: what time it is, and how long passed outside the story when time follows the wall clock. */
  beginTurn(turn: number): { time: StoryTime; away?: number; agenda: SceneAgenda }
  /** A round passes; the time it took is the game master's to say (`stated`, in seconds) or the default, and at least the `minimum` the player's journey took. */
  endRound(turn: number, round: number, stated?: number, minimum?: number): { from: number; to: number; zone: string; moved: RoutineMove[] }
  /** Skips ahead in the story's time. @throws {ClockError} */
  skipTime(turn: number, round: number, request: SkipRequest): { from: number; to: number; zone: string; reason: string; moved: RoutineMove[] }
  /** What is tracked that a character can tell: of itself, and of those with it. */
  trackedFor(characterId: Character['id'], presentIds: readonly number[]): { self: string; others: { name: string; text: string }[] }
  /** What the story tracks, as the game master is told it: the scene first (who is with the player, the place, what lies there, the world), then the rest. */
  tracked(): string[]
  /** What has fallen due for characters who are away from the player's character and has not been dealt with. */
  dueOffScene(turn: number): OffSceneItem[]
  /** Remember these as dealt with. */
  markHandled(keys: readonly string[]): void
  /** Fire the triggers whose conditions just came true, at this round; each is applied together with its effects or not at all. */
  runTriggers(turn: number, round: number): TriggerReport
  /** What is known beforehand of what is coming (announced triggers), for the game master: who knows of each, and when it is to happen. */
  upcoming(turn: number): { text: string; who: string; when?: string }[]
  /** The same, for what one character knows of: it is among those who know. */
  upcomingFor(characterId: Character['id'], turn: number): { text: string; when?: string }[]
  /** What the game master was told to weave in and has not yet. */
  pendingBeats(): { id: number; text: string }[]
  /** The game master wove these in. @throws {Error} for an id that is not a pending beat. */
  resolveBeats(ids: readonly number[]): void
  /** What a character is to notice the next time it acts. */
  cuesFor(characterId: Character['id']): { id: number; text: string }[]
  doneCues(ids: readonly number[]): void
  /** Lets go of what nobody took up in the turns the settings allow. */
  lapseNotes(turn: number): void
  /** Shows the player a note beside the story until the next turn starts. */
  putNote(note: Note): void
  /** Adds lines to the turn's note of the kind. */
  addNote(kind: Note['kind'], turn: number, lines: readonly string[]): void
  /** Keeps how a helper's run went, for the settings tab. */
  recordActivity(entry: ActivityEntry, detail?: RunDetail): void
  /** The notes of the session as they stand. */
  notes(): Note[]
  /** Removes the notes: they belong to the turn that made them. */
  clearNotes(): void
  /** A character's agenda now: its day, its commitments and its goals. */
  agenda(turn: number, characterId: Character['id']): AgendaView
  /** Writes the updates of one round, moves included, together or not at all. */
  commit(updates: readonly { character: Character['id']; patch: CharacterStatePatch; move?: Move; items?: readonly ItemChangeSpec[] }[]): ItemEffect[][]
  /** Why these changes to what is tracked cannot be made, if they cannot; nothing is changed. */
  checkVariableChanges(changes: readonly VariableChangeSpec[]): string[]
  /** Changes what is tracked, together or not at all, and says what each came to. */
  changeVariables(turn: number, changes: readonly VariableChangeSpec[]): VariableEffect[]
  /** Whether these item changes, done in order across the characters, can all be done; the reasons when not. Nothing is changed. */
  checkItemChanges(entries: readonly { character: string; changes: readonly ItemChangeSpec[] }[]): { ok: true; effects: ItemEffect[][] } | { ok: false; problems: string[] }
  /** What lies in a place, hidden things too when asked. */
  itemsAt(locationId: Location['id'], withHidden?: boolean): ItemView[]
  /** What a character has on it or in its hands. */
  carried(characterId: Character['id']): ItemView[]
  /** Observe the present scene and return the entities this character knows. */
  knowledge(characterId: Character['id'], turn: number, visibleCharacters?: readonly Character['id'][]): KnowledgeView
  affiliations(characterId: Character['id']): FactionAffiliationView[]
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
