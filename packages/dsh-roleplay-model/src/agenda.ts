import type { CharacterId } from './session.ts'
import type { LocationId } from './location.ts'

/** A recurring stretch of the day in which a character is occupied with something, in a place. */
export interface RoutineWindow {
  /** The days of the week it applies on, 0 for Sunday; every day when empty. A window past midnight belongs to the day it starts on. */
  days: number[]
  /**
   * Other days it applies on or does not (`dec`, `12-24`, `season:winter`, `nth:mon:1`, `holiday:<id>`, a `!` before one for a day it does not apply
   * on): it applies on a day that is among `days` and that these allow. Every day when empty or left out.
   */
  on?: string[]
  /** The minute of the day it starts, 0 to 1439. */
  start: number
  /** The minute it ends (exclusive); before `start` it ends the next day. Equal to `start` is not a window. */
  end: number
  activity: string
  locationId?: LocationId
  featureKey?: string
  /** Where in the place, in words. */
  position?: string
  /** Whether the character will drop it to join something that comes up; a shift at work may not be. */
  interruptible: boolean
}

export interface StoredRoutineWindow extends RoutineWindow {
  on: string[]
  id: number
  characterId: CharacterId
}

/** A routine window as a world's files write it. */
export interface RoutineDefinition {
  /** Three-letter days (`mon` to `sun`); every day when left out. */
  days: string[]
  /** Other days it applies on or does not, as for {@link RoutineWindow.on}. */
  on?: string[]
  /** `HH:MM`. */
  from: string
  to: string
  activity: string
  /** The id of a place in the world. */
  location?: string
  feature?: string
  position?: string
  interruptible: boolean
}

export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type EngagementId = number

export const ENGAGEMENT_STATUSES = ['pending', 'kept', 'missed', 'cancelled'] as const
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]

/** Something dated that characters have committed to: a meeting, an errand, an event they are to attend. */
export interface Engagement {
  id: EngagementId
  title: string
  /** When it is due, in UTC milliseconds. */
  at: number
  /** When it is over, when that is not simply soon after `at`. */
  until?: number
  locationId?: LocationId
  participants: CharacterId[]
  status: EngagementStatus
  note: string
  createdTurn: number
  updatedTurn: number
}

export interface NewEngagement {
  title: string
  at: number
  until?: number
  locationId?: LocationId
  participants: CharacterId[]
  note?: string
  turn: number
}

export interface EngagementPatch {
  title?: string
  at?: number
  until?: number
  locationId?: LocationId
  participants?: CharacterId[]
  status?: EngagementStatus
  note?: string
  turn: number
}

export interface EngagementFilter {
  status?: EngagementStatus
  participant?: CharacterId
  /** Only those due at or after this instant. */
  from?: number
  /** Only those due before this instant. */
  to?: number
}
