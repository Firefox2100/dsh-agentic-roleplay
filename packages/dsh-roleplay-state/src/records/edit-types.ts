import type {
  VariableDefinitionInput, TriggerDefinition,
  Accuracy, Character, CharacterKind, CharacterStatePatch, CharacterTier, ContainerState, EngagementStatus, ExitState, IntentHorizon, IntentStatus, IntentType, KnowledgeKind, Location, MemoryConfidence, MemoryKind, PerceptionMode, Slot,
} from 'dsh-roleplay-model'
import type {
  CharacterRepository, CharacterStateRepository, ConsolidationRepository, EngagementRepository, EventRepository, IntentRepository, ItemRepository, LocationRepository, MemoryRepository,
  KnowledgeRepository, MetadataRepository, PlacementRepository, RelationshipRepository, RoutineRepository, SlotRepository, ThreadRepository, TriggerRepository, VariableRepository,
  FactionRepository, FactionStateRepository, FactionMembershipRepository, FactionRelationshipRepository, FactionIntentRepository,
} from '../repositories.ts'
import type { ItemChangeSpec } from './items.ts'
import type { VariableChangeSpec } from './variables.ts'

/** The name by which models and other plugins refer to a place: its id in the world, or its number when it was made up in play. */

export const locationKey = (location: Pick<Location, 'id' | 'sourceId'>): string => location.sourceId ?? String(location.id)

/** The name by which models and other plugins refer to a character: its id in the world, or its number when it has none. */
export const characterKey = (character: Pick<Character, 'id' | 'sourceId'>): string => character.sourceId ?? String(character.id)

/** What an edit of the story's records can touch. */
export interface RecordsTarget {
  characters: CharacterRepository
  characterStates: CharacterStateRepository
  events: EventRepository
  memories: MemoryRepository
  threads: ThreadRepository
  locations: LocationRepository
  placements: PlacementRepository
  relationships: RelationshipRepository
  factions: FactionRepository
  factionStates: FactionStateRepository
  factionMemberships: FactionMembershipRepository
  factionRelationships: FactionRelationshipRepository
  factionIntents: FactionIntentRepository
  knowledge: KnowledgeRepository
  consolidation: ConsolidationRepository
  items: ItemRepository
  slots: SlotRepository
  intents: IntentRepository
  variables: VariableRepository
  routines: RoutineRepository
  engagements: EngagementRepository
  triggers: TriggerRepository
  /** What the story keeps about itself; the calendar of its world is read from here. */
  metadata: Pick<MetadataRepository, 'getValue'>
  transaction<T>(fn: () => T): T
}

export interface PerceivedBy {
  character: string
  mode: PerceptionMode
  /** What the character took in, when it is not exactly the event. */
  content?: string
  gist?: string
  accuracy?: Accuracy
}

export interface StatePatch extends Pick<CharacterStatePatch, 'publicState' | 'innerState' | 'activity'> {
  character: string
}

export interface NewEvent {
  /** The key of the place it happened in. */
  location?: string
  /** The keys of the items it is about. */
  items?: string[]
  turn: number
  round: number
  text: string
  importance: number
  tags?: string[]
  involves?: string[]
  perceivedBy?: PerceivedBy[]
}

export interface EventEdit {
  id: number
  location?: string
  text?: string
  importance?: number
  tags?: string[]
  involves?: string[]
  /** Replaces who took the event in. */
  perceivedBy?: PerceivedBy[]
}

/** A character's version of an event, revised: it learned more, or remembers it differently. Works on sealed events too. */
export interface PerceptionEdit {
  id: number
  mode?: PerceptionMode
  content?: string
  gist?: string
  accuracy?: Accuracy
}

/** One more character took in an event, possibly long after: it was told, or worked it out. Works on sealed events too. */
export interface PerceptionAddition extends PerceivedBy {
  event: number
}

export interface NewExit {
  /** The key of the place it leads to. */
  to: string
  description?: string
  /** Also make the way back, with `backDescription`; on by default. */
  oneWay?: boolean
  backDescription?: string
  travelSeconds?: number
  state?: ExitState
  note?: string
}

/** A place made up in play (or arriving with a plugin): a hidden passage, a room the story opens. */
export interface NewPlace {
  key: string
  name: string
  description?: string
  /** The key of the place it is in. */
  parent?: string
  features?: { key: string; name: string; description?: string }[]
  exits?: NewExit[]
  /** Why it was made, for whoever fits it into the world later. */
  note?: string
}

/** A character the story makes up: someone who arrives, is introduced, or turns out to be needed. Always played by an agent. */
export interface NewCharacterSpec {
  key: string
  name: string
  aliases?: string[]
  age?: string
  gender?: string
  pronouns?: string
  kind?: CharacterKind
  tier?: CharacterTier
  summary: string
  personality?: string
  background?: string
  appearance?: string
  speech?: { style: string; examples?: string[] }
  state?: { publicState?: string; innerState?: string; activity?: string }
  place?: { location: string; position?: string; feature?: string }
  /** Why it was made, for whoever fits it into the world later. */
  note?: string
}

/** A character's profile of another, made or changed; what is not given stays as it was. */
export interface RelationshipSet {
  from: string
  to: string
  label?: string
  summary?: string
  familiarity?: number
  trust?: number
  affinity?: number
  tension?: number
}

export interface RelationshipRetraction {
  from: string
  to: string
}

/** A place, item or directed exit a character learns exists. */
export interface KnowledgeSet {
  character: string
  kind: KnowledgeKind
  /** The location or item key. */
  subject?: string
  /** For an exit, its directed endpoints. */
  from?: string
  to?: string
  observed?: boolean
}

export interface FactionStateSet { faction: string; publicState?: string; innerState?: string }
export interface FactionMembershipSet { faction: string; character: string; role?: string; rank?: string; status?: 'active' | 'inactive' | 'former'; public?: boolean; commitment?: number; leftTurn?: number }
export interface FactionRelationshipSet extends Omit<RelationshipSet, 'from' | 'to'> { fromKind: 'character' | 'faction'; from: string; toKind: 'character' | 'faction'; to: string }
export interface NewFactionIntentSpec extends Omit<NewIntentSpec, 'character'> { faction: string }

export type KnowledgeRetraction = Omit<KnowledgeSet, 'observed'>

/** A new way between two places that already exist (or are made in the same edit). */
export interface NewExitBetween {
  from: string
  to: string
  description?: string
  /** Also make the way back, with `backDescription`; on by default. */
  oneWay?: boolean
  backDescription?: string
  travelSeconds?: number
  state?: ExitState
  note?: string
}

/** A thing the story makes up (or that arrives with a plugin): an object that matters, handed over or found. It starts in exactly one of `at`, `heldBy`, `wornBy` or `inside`. */
export interface NewItemSpec {
  key: string
  name: string
  description?: string
  quantity?: number
  unique?: boolean
  quality?: string
  notable?: boolean
  hidden?: boolean
  /** The slot it is worn in. */
  wearable?: string
  container?: { state?: ContainerState; openedBy?: string[] }
  owner?: string
  at?: { location: string; position?: string; feature?: string }
  heldBy?: string
  wornBy?: string
  wornPosition?: string
  inside?: string
  insidePosition?: string
  /** Why it was made, for whoever fits it into the world later. */
  note?: string
}

/** What a character does with an item; the engine decides it, this is for plugins and tools. */
export interface ItemChange extends ItemChangeSpec {
  character: string
}

export interface ItemEditSpec {
  item: string
  description?: string
  quality?: string
  quantity?: number
  notable?: boolean
  hidden?: boolean
  /** The state of a container, when it is changed by the story rather than by a character's action. */
  state?: ContainerState
  owner?: string
  /** Replaces the items that open it (a container or the way named by `exit`). */
  openedBy?: string[]
}

export interface PlaceEdit {
  place: string
  name?: string
  description?: string
  /** Replaces the list of features. */
  features?: { key: string; name: string; description?: string }[]
}

/** A door is unlocked, a passage collapses: the way between two places changes, both ways unless told otherwise. */
export interface ExitChange {
  from: string
  to: string
  state?: ExitState
  description?: string
  note?: string
  travelSeconds?: number
  oneWay?: boolean
}

export interface CharacterMove {
  character: string
  to: string
  position?: string
  feature?: string
  ignoreExits?: boolean
}

export interface NewBelief {
  character: string
  kind: MemoryKind
  text: string
  about?: string[]
  importance: number
  /** How sure the character is; likely when not said. */
  confidence?: MemoryConfidence
  /** The numbers of perceptions of the character's own that it rests on, and that speak against it. */
  evidenceFor?: number[]
  evidenceAgainst?: number[]
}

export interface BeliefEdit {
  id: number
  text?: string
  about?: string[]
  importance?: number
  confidence?: MemoryConfidence
  evidenceFor?: number[]
  evidenceAgainst?: number[]
}

/**
 * A change to the story's records, applied together or not at all: the unit in which the
 * record keeper, the model-facing tools and other plugins write what happened.
 */
/** A new goal of a character, which the story gave it: a promise made, a task taken on. */
export interface NewIntentSpec {
  character: string
  type: IntentType
  name: string
  description?: string
  horizon: IntentHorizon
  priority: number
  urgency: number
  plan?: string[]
  constraints?: string[]
  /** A date and time, in the time zone of the story unless it carries an offset. */
  deadline?: string
}

export interface IntentEditSpec {
  id: number
  status?: IntentStatus
  description?: string
  horizon?: IntentHorizon
  priority?: number
  urgency?: number
  plan?: string[]
  openThreads?: string[]
  deadline?: string
}

/** Something characters have committed to, at a time. */
export interface NewEngagementSpec {
  title: string
  /** When it is due: a date and time, in the time zone of the story unless it carries an offset. */
  at: string
  until?: string
  /** The key of the place. */
  location?: string
  participants: string[]
  note?: string
}

export interface EngagementEditSpec {
  id: number
  status?: EngagementStatus
  title?: string
  at?: string
  until?: string
  location?: string
  participants?: string[]
  note?: string
}

export interface RoutineWindowSpec {
  /** `mon` to `sun`; every day when left out. */
  days?: string[]
  /** Other days it applies on or not: `dec`, `12-24`, `season:winter`, `nth:mon:1`, `holiday:<id>`, `!` before one for a day it does not apply on. */
  on?: string[]
  /** `HH:MM`. */
  from: string
  to: string
  activity: string
  location?: string
  feature?: string
  position?: string
  interruptible?: boolean
}

/** One day on which a character does something other than its routine says: it takes the place of the routine's windows on that date and is dropped when the same date is set again. */
export interface RoutineExceptionSpec {
  character: string
  /** The date, `YYYY-MM-DD`, in the story's time zone. */
  date: string
  activity: string
  /** `HH:MM`; the whole day when left out. */
  from?: string
  to?: string
  location?: string
  feature?: string
  position?: string
  interruptible?: boolean
}

/** Sets the recurring day of a character, replacing what it had. */
export interface RoutineSet {
  character: string
  windows: RoutineWindowSpec[]
}

export interface RecordsEdit {
  /** The turn new beliefs and threads belong to. */
  turn: number
  /** The time zone the dates of the edit are written in; UTC when not given. */
  timeZone?: string
  /** Changes to what the story tracks: a feeling, a debt, a flag. */
  variableChanges?: VariableChangeSpec[]
  /** Variables the story declares, only by the agent whose work that is. */
  variables?: VariableDefinitionInput[]
  intentsAdded?: NewIntentSpec[]
  intentEdits?: IntentEditSpec[]
  engagements?: NewEngagementSpec[]
  engagementEdits?: EngagementEditSpec[]
  routines?: RoutineSet[]
  routineExceptions?: RoutineExceptionSpec[]
  /** Things the world does when their conditions come true, only by the agent whose work that is. */
  triggers?: TriggerDefinition[]
  states?: StatePatch[]
  events?: NewEvent[]
  eventEdits?: EventEdit[]
  eventRetractions?: number[]
  perceptionEdits?: PerceptionEdit[]
  perceptionsAdded?: PerceptionAddition[]
  characters?: NewCharacterSpec[]
  items?: NewItemSpec[]
  slots?: Slot[]
  itemChanges?: ItemChange[]
  itemEdits?: ItemEditSpec[]
  places?: NewPlace[]
  exits?: NewExitBetween[]
  relationships?: RelationshipSet[]
  relationshipRetractions?: RelationshipRetraction[]
  knowledge?: KnowledgeSet[]
  knowledgeRetractions?: KnowledgeRetraction[]
  factionStates?: FactionStateSet[]
  factionMemberships?: FactionMembershipSet[]
  factionRelationships?: FactionRelationshipSet[]
  factionIntentsAdded?: NewFactionIntentSpec[]
  placeEdits?: PlaceEdit[]
  exitChanges?: ExitChange[]
  moves?: CharacterMove[]
  beliefs?: NewBelief[]
  beliefEdits?: BeliefEdit[]
  beliefRetractions?: number[]
  threadsOpened?: string[]
  threadsResolved?: number[]
}

export interface EditResult {
  /** The ids of the events and beliefs the edit added, in order. */
  eventIds: number[]
  /** The keys of the characters and places the edit made up. */
  characterKeys?: string[]
  placeKeys?: string[]
  triggerKeys?: string[]
  itemKeys?: string[]
  /** The keys of the variables the edit declared. */
  variableKeys?: string[]
  beliefIds: number[]
  /** How many rows were added, changed or removed. */
  writes: number
}
