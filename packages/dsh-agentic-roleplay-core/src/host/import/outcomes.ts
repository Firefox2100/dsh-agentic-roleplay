import { ROLE_TABLE, type Role } from './roles.ts'
import type { CardPiece, Source } from './card-tools.ts'
import { baseId } from './card-tools.ts'

/**
 * What became of one piece of a card: `carried` is kept word for word (an opening), `converted` made characters, places, things or other entries of the world, `guidance`
 * became instructions to the narrator, `read` was read for the world but nothing named came of it, `omitted` was left out on purpose, `awaiting` has not been looked at yet.
 */
export const OUTCOMES = ['carried', 'converted', 'guidance', 'read', 'omitted', 'awaiting'] as const
export type Outcome = typeof OUTCOMES[number]

export interface PieceOutcome {
  piece: string
  label: string
  outcome: Outcome
  /** Why, in a few words, when the outcome alone does not say. */
  because?: string
  /** The characters, places and things made from it. */
  madeInto: string[]
}

const rolesOf = (source: Source, id: string): Role[] => [...new Set(Object.entries(source.records.classified ?? {}).filter(([key]) => baseId(key) === id).flatMap(([, entry]) => entry.roles))]

function outcomeOf(source: Source, piece: CardPiece, made: readonly string[]): Omit<PieceOutcome, 'piece' | 'label' | 'madeInto'> {
  const { choices, card } = source
  const reported = source.records.report !== undefined
  if (piece.id === 'field:creator-notes') return { outcome: 'omitted', because: 'notes to people, not part of the world' }
  if (piece.id === 'field:first-message' || piece.id.startsWith('field:greeting-')) {
    if (choices.opening.kind === 'none') return { outcome: 'omitted', because: 'the person chose no opening' }
    return reported ? { outcome: 'carried', because: 'an opening of the world' } : { outcome: 'awaiting' }
  }
  if (piece.id === 'field:system-prompt' || piece.id === 'field:post-history') return reported ? { outcome: 'guidance', because: 'instructions to the narrator' } : { outcome: 'awaiting' }
  if (piece.enabled !== undefined && choices.disabledEntries.includes(piece.id)) return { outcome: 'omitted', because: 'left off by the person' }
  if (piece.enabled === false && !(card.book?.entries.find(entry => entry.id === piece.id)?.enabled ?? true) && !piece.used) return { outcome: 'omitted', because: 'switched off in the card' }
  if (source.records.classified === undefined) return { outcome: 'awaiting' }
  const roles = rolesOf(source, piece.id)
  if (roles.length === 0) return { outcome: 'awaiting', because: 'the import did not classify it' }
  if (roles.every(role => ROLE_TABLE[role].leftOut)) {
    return roles.includes('instruction') ? { outcome: 'guidance', because: 'how to run a story, not facts of this one' } : { outcome: 'omitted', because: roles.includes('template') ? 'a template or format of the source tool' : 'nothing to do with the story' }
  }
  return made.length > 0 ? { outcome: 'converted' } : { outcome: 'read', because: 'no character, place or thing is named after it' }
}

/** What became of every piece of the card, from the import's records; `made` is `entitiesByPiece` of the same source. */
export function pieceOutcomes(source: Source, made: ReadonlyMap<string, readonly string[]>): PieceOutcome[] {
  return source.pieces.map(piece => ({ piece: piece.id, label: piece.label, ...outcomeOf(source, piece, made.get(piece.id) ?? []), madeInto: [...made.get(piece.id) ?? []] }))
}

export const outcomeCounts = (outcomes: readonly PieceOutcome[]): Record<Outcome, number> => Object.fromEntries(OUTCOMES.map(outcome => [outcome, outcomes.filter(entry => entry.outcome === outcome).length])) as Record<Outcome, number>
