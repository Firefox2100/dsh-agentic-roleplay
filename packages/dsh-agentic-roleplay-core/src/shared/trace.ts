import type { RequestStat } from './diagnostics.ts'

/** A part of a model request's prompt and its size, estimated from the text: the service counts only the whole. */
export interface PromptPart {
  /** `system`, `tools`, `notices` (what the story told the agent at the start of its turn), `input` (what it was asked), `steps` (its own earlier calls and their results this turn), `earlier` (the rest of the conversation, which is what the reported total leaves). */
  id: string
  tokens: number
}

/** One tool call of the game master and how it went. */
export interface MasterCall {
  tool: string
  /** Milliseconds from the call to its result. */
  ms?: number
  /** The harness or the tool refused it. */
  failed: boolean
  /** The reason it was refused, or the start of what it returned. */
  note: string
}

/** One earlier event the game master was reminded of at the start of the turn, and what brought it back. */
export interface RemindedEvent {
  turn: number
  text: string
  how: 'search' | 'cues'
}

/** What the game master was reminded of from the records, and how much was left out. */
export interface SceneSelection {
  events: RemindedEvent[]
  /** Candidates the limit left out. */
  omitted: number
  /** How many turns the summaries have folded out of the conversation: only they are searched. */
  folded: number
}

/** How many of each kind of thing a character was given, or was not given although the story holds it. */
export interface AccessCounts {
  people: number
  places: number
  things: number
  routes: number
  factions: number
  lore: number
}

/** Names behind the withheld counts; kept only when the story keeps what the helpers were told, because they are what the character must not know. */
export type WithheldNames = Partial<Record<keyof AccessCounts, string[]>>

/** What one character was given for one activation and what the story holds that it was not given. */
export interface CharacterAccess {
  character: string
  /** The round's attempt: 2 is the retry. */
  attempt: number
  given: AccessCounts & {
    memories: { clear: number; faded: number; vague: number }
    relationships: number
    present: number
    carrying: number
    cues: number
  }
  withheld: AccessCounts & {
    /** Hidden things in the character's own place. */
    hidden: number
    /** Events the story recorded that this character took no part in. */
    events: number
  }
  names?: WithheldNames
}

/** Where the game master's turn went and what it was given, from the chat's log and what the store knew at the time. */
export interface TurnTrace {
  turn: number
  startedAt: number
  /** When the output was delivered; absent while the turn runs. */
  endedAt?: number
  /** From the start of the turn to the first request: the wait for earlier background work and the scene notice. */
  beforeMs?: number
  /** The game master's requests with the parts of each prompt. */
  requests?: RequestStat[]
  calls?: MasterCall[]
  /** What stopped the turn from ending or ran the game master on after a refusal: the harness's own messages to it. */
  steered?: string[]
  /** The sections of the scene notice. */
  scene?: PromptPart[]
  selected?: SceneSelection
  access?: CharacterAccess[]
}

/** The most turns a session keeps a trace of: the oldest are dropped. */
export const MAX_TRACES = 30
/** The most calls, steering messages and characters one trace keeps. */
export const MAX_TRACE_CALLS = 60
export const MAX_TRACE_STEERED = 20
export const MAX_TRACE_ACCESS = 40
/** Longest note kept for one call or steering message. */
export const MAX_TRACE_NOTE = 240
