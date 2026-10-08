import type { CharacterId } from './session.ts'

export const KNOWLEDGE_KINDS = ['location', 'item', 'exit', 'lore'] as const
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number]

/** That a character knows a place, thing or way exists. Current facts about it come from perception and memory. */
export interface EntityKnowledge {
  characterId: CharacterId
  subjectKind: KnowledgeKind
  subjectId: number
  learnedTurn: number
  lastObservedTurn?: number
}

/** What a character file says the character knows when the story starts. */
export interface KnowledgeDefinition {
  locations: string[]
  items: string[]
  exits: { from: string; to: string }[]
  lore?: string[]
}
