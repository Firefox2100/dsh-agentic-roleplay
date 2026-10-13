import type { VariableValue } from './variable.ts'

export type TriggerId = number

export const COMPARISONS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const
export type Comparison = (typeof COMPARISONS)[number]

/**
 * When something happens, decided in code from what the story has recorded; only `judged` is a model's reading of the story, kept as a verdict that the code reads.
 * Keys name characters, places, items and variables as the world's files and the tools do. Times are local to
 * the story's zone: `YYYY-MM-DDTHH:MM`, and `HH:MM` for a time of day.
 */
export type TriggerCondition =
  /** True from `from` on, until `to`; or while the time of day is in `window` (past midnight when it ends before it starts), on `days` (`mon` to `sun`) when given. */
  | { type: 'time'; from?: string; to?: string; window?: { from: string; to: string }; days?: string[] }
  /** A character is in a place, at a feature of it when given. */
  | { type: 'place'; character: string; location: string; feature?: string }
  /** A variable compares to a value; `subject` is the key of the character, item or place it is about, none for a world variable. */
  | { type: 'variable'; variable: string; subject?: string; op: Comparison; value: VariableValue }
  /** An item is held by a character, or lies in a place (also inside something there). */
  | { type: 'item'; item: string; heldBy?: string; at?: string }
  /** An event with this tag was recorded. */
  | { type: 'event'; tag: string }
  /** Another trigger has fired. */
  | { type: 'fired'; trigger: string }
  /** A statement about the story that a model judges true or false after each turn, for what no record can say ("the mayor has lost the town's trust"); false until judged. */
  | { type: 'judged'; text: string }
  | { type: 'all'; conditions: TriggerCondition[] }
  | { type: 'any'; conditions: TriggerCondition[] }
  | { type: 'not'; condition: TriggerCondition }

/** Who a cue is for, or who knows of something coming: everyone, named characters, or whoever is in a place at that moment. */
export type TriggerAudience = 'everyone' | { characters: string[] } | { place: string }

/**
 * What is known before a trigger fires, and by whom: a scheduled event that is no secret (an exam, a ball, a deadline).
 * Without it a trigger is a secret until it fires.
 */
export interface TriggerAnnouncement {
  audience: TriggerAudience
  /** What is known beforehand: the public side of it, never what the effects do. */
  text: string
  /** When it becomes known, a local time; known from the start when left out. */
  from?: string
  /** When it is to happen, a local time, as told with the announcement; the time the condition waits for when it is a plain one, if left out. */
  at?: string
}

/** What happens when a trigger fires. */
export type TriggerEffect =
  /** A checked change of the story's records, in the format of an edit (events, variable changes, exit and item changes, moves, goals, engagements). */
  | { type: 'edit'; edit: Record<string, unknown> }
  /** Something the game master is told to weave into the story, until it says it did or a few turns pass. */
  | { type: 'beat'; text: string }
  /** Something the audience notices, said to each of them the next time they act. */
  | { type: 'cue'; audience: TriggerAudience; text: string }

export const TRIGGER_STATUSES = ['dormant', 'fired', 'failed', 'expired'] as const
export type TriggerStatus = (typeof TRIGGER_STATUSES)[number]

/** A trigger as a world's files, or the world author, write it. */
export interface TriggerDefinition {
  key: string
  name: string
  condition: TriggerCondition
  effects: TriggerEffect[]
  /** Whether it can fire again after it fired and its condition went false and true again. */
  repeat: boolean
  /** With `repeat`, the least story time between two firings, in seconds. */
  cooldownSeconds?: number
  /** The chance, 0 to 1, that a rising condition fires; a failed roll uses that rise up. */
  chance?: number
  /** The higher goes first when several are due at once. */
  priority: number
  /** After this local time it never fires. */
  expires?: string
  /** Known beforehand by whom, and what; without it, nobody knows until it fires. */
  announce?: TriggerAnnouncement
}

export interface Trigger extends TriggerDefinition {
  id: TriggerId
  status: TriggerStatus
  fireCount: number
  lastFiredMs?: number
  /** What the condition was when it was last looked at, to see it rise. */
  lastResult: boolean
  /** Why it failed, when it did. */
  problem?: string
  origin: 'world' | 'story'
  createdTurn: number
}

export const TRIGGER_NOTE_KINDS = ['beat', 'cue'] as const
export type TriggerNoteKind = (typeof TRIGGER_NOTE_KINDS)[number]

/** What a fired trigger leaves to be told: a beat for the game master, a cue for characters. */
export interface TriggerNote {
  id: number
  triggerId: TriggerId
  kind: TriggerNoteKind
  text: string
  /** The characters a cue is for. */
  characterIds: number[]
  turn: number
  status: 'pending' | 'done' | 'lapsed'
}

export interface NewTriggerNote {
  triggerId: TriggerId
  kind: TriggerNoteKind
  text: string
  characterIds?: number[]
  turn: number
}

/** At most this many triggers in a story. */
export const MAX_TRIGGERS = 200
