import type { CharacterId } from './session.ts'

export type RelationshipId = number

/** How a character stands towards another: a short profile, not a single edge. Each direction is its own profile. */
export interface Relationship {
  id: RelationshipId
  /** Whose view it is. */
  fromId: CharacterId
  toId: CharacterId
  /** What the other is to this character, in a word or two: "sister", "rival", "landlord". */
  label: string
  /** The relationship in a sentence or two: how it came about, what it is like now. */
  summary: string
  /** How well it knows the other, from 0 (a stranger) to 1 (intimately). */
  familiarity: number
  /** From -1 (distrusts) to 1 (trusts completely). */
  trust: number
  /** From -1 (dislikes) to 1 (is fond of). */
  affinity: number
  /** How strained it is right now, from 0 to 1. */
  tension: number
  /** The turn it last changed. */
  updatedTurn: number
  createdAt: string
}

export interface NewRelationship {
  fromId: CharacterId
  toId: CharacterId
  label: string
  summary?: string
  familiarity?: number
  trust?: number
  affinity?: number
  tension?: number
}

export type RelationshipPatch = Partial<Pick<Relationship, 'label' | 'summary' | 'familiarity' | 'trust' | 'affinity' | 'tension'>>

/** A relationship as the world's files write it: from the character whose file it is in, to another by its id in the world. */
export interface RelationshipDefinition {
  to: string
  label: string
  summary: string
  familiarity: number
  trust: number
  affinity: number
  tension: number
}

/** What was made up in play and still has to be fitted into the rest of the world. */
export const CONSOLIDATION_KINDS = ['character', 'location'] as const
export type ConsolidationKind = (typeof CONSOLIDATION_KINDS)[number]

export type ConsolidationItemId = number

export interface ConsolidationItem {
  id: ConsolidationItemId
  kind: ConsolidationKind
  /** The id of the character or place. */
  subjectId: number
  /** Why it was made, in the words of whoever asked for it. */
  note: string
  createdTurn: number
  resolvedTurn?: number
  /** What was done to fit it in, when it is resolved. */
  resolution?: string
}
