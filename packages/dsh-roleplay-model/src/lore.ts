export type LoreId = number

export const LORE_KINDS = ['history', 'culture', 'religion', 'politics', 'geography', 'science', 'custom', 'legend', 'other'] as const
export type LoreKind = typeof LORE_KINDS[number]

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
  summary: string
  body: string
  startsAt?: number
  endsAt?: number
  subjects: LoreSubject[]
  related: LoreId[]
  sources: string[]
  createdAt: string
}

export type NewLore = Omit<Lore, 'id' | 'createdAt'>
export type LorePatch = Partial<Pick<Lore, 'title' | 'kind' | 'summary' | 'body' | 'subjects' | 'related' | 'sources'>> & { startsAt?: number | null; endsAt?: number | null }

export interface LoreSubjectDefinition {
  kind: LoreSubjectKind
  id: string
}

/** One independently addressable piece of canonical world lore. */
export interface LoreDefinition {
  id: string
  title: string
  kind: LoreKind
  summary: string
  body: string
  startsAt?: number
  endsAt?: number
  subjects: LoreSubjectDefinition[]
  related: string[]
  sources: string[]
}
