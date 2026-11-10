/** The pages of the reference: what the player may look up about the story, never what only the story knows. */
export const REFERENCE_SECTIONS = ['status', 'profile', 'people', 'places', 'things', 'quests'] as const
export type ReferenceSection = (typeof REFERENCE_SECTIONS)[number]

/** The tracked values of one subject the player may read, all of them, defaults included. */
export interface ReferenceStatus {
  subject: 'world' | 'player' | 'place' | 'person' | 'thing'
  key?: string
  /** Absent for the world. */
  name?: string
  here?: boolean
  values: { name: string; value: string }[]
}

export interface ReferencePerson {
  key: string
  name: string
  /** What anyone present can see or infer. */
  publicState: string
  /** At the player's place now. */
  here: boolean
  /** What this person is to the player's character, when they have met. */
  label?: string
  summary?: string
}

export interface ReferencePlace {
  key: string
  name: string
  here: boolean
  parent?: string
  /** Only for the place the player is in. */
  description?: string
  features: string[]
  /** The ways out the player's character knows of. */
  ways: { to: string; toKey: string; open: boolean }[]
}

export interface ReferenceThing {
  name: string
  quantity: number
  where: 'carried' | 'worn' | 'here'
}

/**
 * A matter the player's character knows of that is not settled, or was settled: a thread the story told them of (the story's other threads stay
 * its own), or a promise or appointment they are part of.
 */
export interface ReferenceQuest {
  kind: 'story' | 'commitment'
  text: string
  status: 'open' | 'resolved'
  /** For a commitment: when it is due, and when it ends if that is stated, in the story's time zone. */
  when?: string
  until?: string
  place?: string
  /** The others a commitment is with. */
  with?: string[]
  note?: string
  /** The turn the thread was opened, or the commitment made. */
  turn: number
  resolvedTurn?: number
}

/** Who is looking: a profile shows a character to themselves in full, and to anyone else only what can be seen. */
export type ReferenceAudience = 'self' | 'observer'

export interface ReferenceRecollection {
  /** What the character took in, in their own words. */
  text: string
  gist: string
  mode: 'witnessed' | 'heard' | 'told' | 'inferred'
  turn: number
}

export interface ReferenceBelief {
  text: string
  kind: 'belief' | 'relationship' | 'knowledge'
  confidence: 'doubtful' | 'likely' | 'sure'
  turn: number
}

export interface ReferenceGoal {
  name: string
  description: string
  status: string
  plan: string[]
  deadline?: string
}

/**
 * A character as one audience may see them. The blocks after `publicState` are present only for `self`: what a person
 * knows of themselves and nobody else may read.
 */
export interface ReferenceProfile {
  key: string
  name: string
  audience: ReferenceAudience
  aliases: string[]
  age?: string
  gender?: string
  pronouns?: string
  appearance: string
  publicState: string
  /** What anyone could tell, as the story shows it: tracked values the story makes public (or all of them, for oneself). */
  values: { name: string; value: string }[]
  summary?: string
  personality?: string
  background?: string
  speech?: { style: string; examples: string[] }
  innerState?: string
  activity?: string
  goals?: ReferenceGoal[]
  groups?: { name: string; role: string }[]
  /** Newest first, at most `PROFILE_MEMORY_LIMIT` each; `totals` counts all. */
  recollections?: ReferenceRecollection[]
  beliefs?: ReferenceBelief[]
  totals?: { recollections: number; beliefs: number }
}

export const PROFILE_MEMORY_LIMIT = 100

export interface ReferenceReplies {
  status: ReferenceStatus[]
  profile: ReferenceProfile[]
  people: ReferencePerson[]
  places: ReferencePlace[]
  things: ReferenceThing[]
  quests: ReferenceQuest[]
}

export type ReferenceReply<K extends ReferenceSection = ReferenceSection> = { section: K; entries: ReferenceReplies[K] }

export const isReferenceSection = (value: string): value is ReferenceSection => (REFERENCE_SECTIONS as readonly string[]).includes(value)
