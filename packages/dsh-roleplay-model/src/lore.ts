export type LoreId = number

export const LORE_KINDS = ['history', 'culture', 'religion', 'politics', 'geography', 'science', 'custom', 'legend', 'other'] as const
export type LoreKind = typeof LORE_KINDS[number]

/** Who knows an entry: `everyone` is common knowledge of the story's world, `listed` only the characters that have a knowledge edge to it (the game master always reads all of it). */
export const LORE_SCOPES = ['everyone', 'listed'] as const
export type LoreScope = typeof LORE_SCOPES[number]

export const LORE_SUBJECT_KINDS = ['character', 'faction', 'location', 'item', 'lore'] as const
export type LoreSubjectKind = typeof LORE_SUBJECT_KINDS[number]

export interface LoreSubject {
  kind: LoreSubjectKind
  id: number
}

export interface Lore {
  id: LoreId
  sourceId?: string
  title: string
  kind: LoreKind
  scope: LoreScope
  summary: string
  body: string
  startsAt?: number
  endsAt?: number
  subjects: LoreSubject[]
  related: LoreId[]
  sources: string[]
  createdAt: string
}

export type NewLore = Omit<Lore, 'id' | 'createdAt' | 'scope'> & { scope?: LoreScope }
export type LorePatch = Partial<Pick<Lore, 'title' | 'kind' | 'scope' | 'summary' | 'body' | 'subjects' | 'related' | 'sources'>> & { startsAt?: number | null; endsAt?: number | null }

export interface LoreSubjectDefinition {
  kind: LoreSubjectKind
  id: string
}

/** One independently addressable piece of canonical world lore. */
export interface LoreDefinition {
  id: string
  title: string
  kind: LoreKind
  /** Who knows it; a world's own file says `listed` when it does not say. */
  scope: LoreScope
  /** For a listed entry: the characters that know it, by id, name or alias. */
  knownBy: string[]
  summary: string
  body: string
  startsAt?: number
  endsAt?: number
  subjects: LoreSubjectDefinition[]
  related: string[]
  sources: string[]
}
