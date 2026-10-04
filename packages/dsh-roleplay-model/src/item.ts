import type { CharacterId } from './session.ts'
import type { LocationId } from './location.ts'

export type ItemId = number

/** Whether a container can be got into. */
export const CONTAINER_STATES = ['open', 'closed', 'locked'] as const
export type ContainerState = (typeof CONTAINER_STATES)[number]

/** A place on the body something can be worn. Worlds can have their own; these are what a world starts with. */
export interface Slot {
  /** Short and lowercase: how items and tools name it. */
  id: string
  name: string
  /** How many things can be worn there at once. */
  capacity: number
}

export const SLOT_ID = /^[a-z][a-z0-9_-]{0,39}$/

export const DEFAULT_SLOTS: readonly Slot[] = [
  { id: 'head', name: 'head', capacity: 1 },
  { id: 'face', name: 'face', capacity: 1 },
  { id: 'neck', name: 'neck', capacity: 1 },
  { id: 'torso', name: 'torso', capacity: 2 },
  { id: 'back', name: 'back', capacity: 1 },
  { id: 'waist', name: 'waist', capacity: 1 },
  { id: 'hands', name: 'hands', capacity: 1 },
  { id: 'wrists', name: 'wrists', capacity: 2 },
  { id: 'fingers', name: 'fingers', capacity: 4 },
  { id: 'legs', name: 'legs', capacity: 1 },
  { id: 'feet', name: 'feet', capacity: 1 },
]

/** What can hold other things: a chest, a satchel, a drawer. */
export interface ContainerSpec {
  state: ContainerState
}

/**
 * A thing that can be moved, held, worn, opened or used: one kind for everything physical. What it
 * can do is what it has: a slot it is worn in, a container it holds things in, a quantity when there
 * are several alike. Scenery that cannot be moved (a desk, a window) is a feature of its place instead.
 */
export interface Item {
  id: ItemId
  /** The id in the world's files; absent for something made up in play. */
  sourceId?: string
  name: string
  description: string
  /** How many there are, for things that come in numbers (coins, arrows). */
  quantity: number
  /** Only one exists in the story: it is never split or merged. */
  unique: boolean
  /** Its condition, in words: "worn", "freshly oiled". */
  quality: string
  /** Matters to the story: told first and never left out of a short list. */
  notable: boolean
  /** Not seen by anyone until it is found. */
  hidden: boolean
  /** The slot it is worn in, when it can be worn. */
  wearableSlot?: string
  container?: ContainerSpec
  /** Whose it is, which is not the same as who has it. */
  ownerId?: CharacterId
  createdAt: string
}

export type NewItem = Omit<Item, 'id' | 'createdAt'>
export type ItemPatch = Partial<Pick<Item, 'name' | 'description' | 'quantity' | 'quality' | 'notable' | 'hidden' | 'ownerId'>> & { container?: ContainerSpec }

/** What holds an item: a place, a character (in its hands, or worn) or another item (inside it). */
export type Holder =
  | { kind: 'location'; locationId: LocationId; position?: string; featureKey?: string }
  | { kind: 'character'; characterId: CharacterId; mode: 'held' }
  | { kind: 'character'; characterId: CharacterId; mode: 'worn'; slot: string; position?: string }
  | { kind: 'item'; itemId: ItemId; position?: string }

export interface Holding {
  itemId: ItemId
  holder: Holder
}

/** What an item is, as the world's files write it, before it is put in a session. */
export interface ItemDefinition {
  id: string
  name: string
  description: string
  quantity: number
  unique: boolean
  quality: string
  notable: boolean
  hidden: boolean
  wearable?: string
  container?: { state: ContainerState; openedBy: string[] }
  owner?: string
  /** Where it starts: one of these. */
  start:
    | { kind: 'location'; location: string; position?: string; feature?: string }
    | { kind: 'held'; character: string }
    | { kind: 'worn'; character: string; slot?: string; position?: string }
    | { kind: 'inside'; item: string; position?: string }
  /** For an exit: which of the item's ways it opens is written on the exit; here only what opens this item, if it is a container. */
}

/** The things the world says open its exits, by place and the id of the place it leads to. */
export interface ExitOpener {
  from: string
  to: string
  items: string[]
}
