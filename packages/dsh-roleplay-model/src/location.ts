import type { CharacterId } from './session.ts'

export type LocationId = number
export type ExitId = number

/** A named thing in a place that a story can point at: a desk, a window, a notice board. */
export interface LocationFeature {
  /** Unique within its location; how authors and tools refer to it. */
  key: string
  name: string
  description: string
}

/** At most this many features describe one place, so that a place never overwhelms a prompt. */
export const MAX_LOCATION_FEATURES = 30

export interface Location {
  id: LocationId
  /** The id of the place in the world's files; absent for a place made up in play. */
  sourceId?: string
  name: string
  description: string
  /** The place this one is in (a room in a building, a building in a district). Containment only: it does not say how to get from one to the other. */
  parentId?: LocationId
  features: LocationFeature[]
  createdAt: string
}

export type NewLocation = Omit<Location, 'id' | 'createdAt'>

/** What may change about a place once it exists; where it is stays. */
export type LocationPatch = Partial<Pick<Location, 'name' | 'description' | 'features'>>

/** Whether people can go through an exit now. */
export const EXIT_STATES = ['open', 'locked', 'blocked'] as const
export type ExitState = (typeof EXIT_STATES)[number]

/** A way from one place to another, one direction at a time; a door usually has one each way. */
export interface Exit {
  id: ExitId
  fromId: LocationId
  toId: LocationId
  /** What it looks like from the place it leaves: "a narrow stair down to the cellar". */
  description: string
  /** How long going through takes, when it is known. Authored data; nothing here runs a clock. */
  travelSeconds?: number
  /** Open to use; locked until something unlocks it; blocked until the way is cleared. */
  state: ExitState
  /** Why it is locked or blocked, or what opens it. */
  note: string
}

export type NewExit = Omit<Exit, 'id' | 'state' | 'note'> & { state?: ExitState; note?: string }
export type ExitPatch = Partial<Pick<Exit, 'description' | 'travelSeconds' | 'state' | 'note'>>

/** The kinds of thing that can stand in a place. Characters now; items and containers are placed the same way. */
export const PLACEABLE_KINDS = ['character'] as const
export type PlaceableKind = (typeof PLACEABLE_KINDS)[number]

export interface Placement {
  kind: PlaceableKind
  entityId: CharacterId
  locationId: LocationId
  /** Where in the place, in words: "at the bar", "by the door". */
  position: string
  /** The feature of the place it is at or by, when it is one. */
  featureKey?: string
}

export interface NewPlacement {
  locationId: LocationId
  position?: string
  featureKey?: string
}

/** A request to go somewhere. */
export interface Move {
  to: LocationId
  position?: string
  featureKey?: string
  /** Skip the exits: the story itself carries the character (carried off, teleported, falls). */
  ignoreExits?: boolean
}

/** How a move would go: the places passed through, in order, ending at the destination. */
export interface MovePlan {
  from?: LocationId
  to: LocationId
  via: LocationId[]
  /** The summed travel time when every exit on the way has one. */
  travelSeconds?: number
}

/** One way out of a place as the world's files write it. */
export interface ExitDefinition {
  /** The id of the place it leads to. */
  to: string
  description: string
  /** Whether there is no way back; otherwise the way back is made too. */
  oneWay: boolean
  backDescription?: string
  travelSeconds?: number
  state: ExitState
  note: string
}

/** A place as the world's files write it, before it is put in a session. */
export interface LocationDefinition {
  id: string
  name: string
  description: string
  /** The id of the place it is in. */
  parent?: string
  features: LocationFeature[]
  exits: ExitDefinition[]
}
