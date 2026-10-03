import type { CharacterId } from './session.ts'
import type { JsonValue } from './json.ts'

/** How a character came to take in an event. */
export const PERCEPTION_MODES = ['witnessed', 'heard', 'told', 'inferred'] as const
export type PerceptionMode = (typeof PERCEPTION_MODES)[number]

/** How well what a character took in matches what happened; recorded for checking, never shown to the character. */
export const ACCURACIES = ['accurate', 'partial', 'mistaken'] as const
export type Accuracy = (typeof ACCURACIES)[number]

export const MEMORY_KINDS = ['belief', 'relationship', 'knowledge'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const THREAD_STATUSES = ['open', 'resolved'] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]

/** A digest covers a stretch of recent turns closely; a chapter covers older turns briefly. */
export const SUMMARY_LEVELS = ['digest', 'chapter'] as const
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number]

export const IMPORTANCE_MIN = 1
export const IMPORTANCE_MAX = 5

export type EventId = number
export type PerceptionId = number
export type MemoryId = number
export type ThreadId = number
export type SummaryId = number

/** Something that objectively happened in the story: the ground truth the rest is derived from. */
export interface StoryEvent {
  id: EventId
  turn: number
  round: number
  text: string
  /** From 1 (passing) to 5 (turns the story). */
  importance: number
  tags: string[]
  /** The characters the event is about: who acted, and who it was done to. */
  involves: CharacterId[]
  createdAt: string
}

export type NewStoryEvent = Omit<StoryEvent, 'id' | 'createdAt'>

export interface StoryEventPatch {
  text?: string
  importance?: number
  tags?: string[]
  involves?: CharacterId[]
}

export interface StoryEventFilter {
  turn?: number
  round?: number
  fromTurn?: number
  toTurn?: number
  involving?: CharacterId
  minImportance?: number
}

/** What one character took in of an event: its own version, which may be partial or wrong. */
export interface Perception {
  id: PerceptionId
  eventId: EventId
  characterId: CharacterId
  mode: PerceptionMode
  /** What the character took in, in full. */
  content: string
  /** The essence of it in a few words, which is what is left of it as it fades. */
  gist: string
  accuracy: Accuracy
  recalls: number
  lastRecalledTurn?: number
  createdAt: string
}

export interface NewPerception {
  characterId: CharacterId
  mode: PerceptionMode
  content: string
  gist: string
  accuracy: Accuracy
}

export interface PerceivedEvent {
  perception: Perception
  event: StoryEvent
}

/** What a character has come to believe or know, beyond single events. */
export interface CharacterMemory {
  id: MemoryId
  characterId: CharacterId
  kind: MemoryKind
  text: string
  /** The characters it is about. */
  about: CharacterId[]
  importance: number
  /** The turn it was formed in. */
  turn: number
  recalls: number
  lastRecalledTurn?: number
  createdAt: string
}

export type NewCharacterMemory = Omit<CharacterMemory, 'id' | 'createdAt' | 'recalls' | 'lastRecalledTurn'>

export interface CharacterMemoryPatch {
  text?: string
  about?: CharacterId[]
  importance?: number
}

/** Something in the story that is not settled yet: a promise, a mystery, a goal. */
export interface StoryThread {
  id: ThreadId
  text: string
  status: ThreadStatus
  openedTurn: number
  resolvedTurn?: number
}

/** A written account of a stretch of turns, built from the events in it. */
export interface Summary {
  id: SummaryId
  level: SummaryLevel
  fromTurn: number
  toTurn: number
  text: string
  createdAt: string
}

export type NewSummary = Omit<Summary, 'id' | 'createdAt'>

/** One recorded round whose events and memories have not been written yet. */
export interface PendingCommit {
  turn: number
  round: number
  payload: JsonValue
  createdAt: string
}
