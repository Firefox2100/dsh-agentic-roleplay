import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { baseId, originOf, readSource, rolesOf, UPDATE_FOLDER, type CardPiece, type CardVersion, type Source } from '../import/card-tools.ts'
import { isLeftOut } from '../import/roles.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import { ENTITY_FOLDERS } from '../worlds/entity-folders.ts'
import { WORLD_FILE_NAME } from '../worlds/world-file.ts'
import { shareOf, termsOf } from './terms.ts'
import type { WorldText } from './world-text.ts'

/** The card to compare a world with: the one it was made from, or the newer one waiting to update it (then also the one it was made from, which the import's records are about). */
export interface CardEvidence {
  version: CardVersion
  source: Source
  /** The card the world was made from, when `source` is the newer one. */
  previous?: Source
}

const exists = async (file: string): Promise<boolean> => await stat(file).then(() => true, () => false)

/** @returns the card of the world, or nothing when the world has none (or no newer version waits, for `new`). */
export async function loadCardEvidence(directory: string, version: CardVersion): Promise<CardEvidence | undefined> {
  const folder = join(directory, IMPORT_FOLDER)
  if (!await exists(join(folder, 'card.json'))) return undefined
  if (version === 'current') return { version, source: await readSource(directory, true) }
  if (!await exists(join(folder, UPDATE_FOLDER, 'card.json'))) return undefined
  return { version, source: await readSource(directory, false, 'new'), previous: await readSource(directory, true) }
}

/** A lore entry or the world's own file counts as made from a piece when this much of its terms are in the piece: a rewrite keeps the facts, and so the words. */
const MADE_FROM = 0.6
const MIN_TERMS = 4

/** The pieces the import read for the world: not the instructions, templates and entries left out, not those it could not classify. */
export function usedPieces(source: Source): CardPiece[] {
  return source.pieces.filter(piece => {
    if (!piece.used || piece.enabled === false) return false
    const roles = rolesOf(source.records.classified, piece.id)
    return roles.length > 0 && !isLeftOut({ roles })
  })
}

/**
 * Which parts of the world each piece of the card was made into: the characters, places, organisations and things the import's records say it was read for, and the lore
 * and world file whose words are mostly the piece's (lore records no source of its own). Keyed by piece, values are keys of `WorldText.texts`. With `about`, a piece that only
 * mentions an entity does not count as one it was made from: what it says of others is not that entity's.
 */
export function madeInto(source: Source, world: WorldText, only: 'any' | 'about' = 'any'): Map<string, string[]> {
  const made = new Map<string, string[]>()
  const add = (piece: string, where: string): void => { const list = made.get(piece) ?? []; if (!list.includes(where)) made.set(piece, [...list, where]) }
  const group = { character: 'characters', place: 'locations', faction: 'factions', thing: 'items' } as const
  for (const entity of source.records.roster ?? []) {
    const where = `${group[entity.kind]}/${entity.key}`
    if (!world.texts.has(where)) continue
    for (const entry of originOf(source.card, source.choices, source.pieces, source.records, entity.name)) if (only === 'any' || entry.how === 'about it') add(entry.piece, where)
  }
  const pieces = usedPieces(source).map(piece => ({ id: baseId(piece.id), terms: termsOf(piece.text) }))
  for (const [where, text] of world.texts) {
    if (!where.startsWith(`${ENTITY_FOLDERS[4].directory}/`) && !where.startsWith(`${WORLD_FILE_NAME}#`)) continue
    const terms = termsOf(text)
    if (terms.size < MIN_TERMS) continue
    for (const piece of pieces) if (shareOf(terms, piece.terms) >= MADE_FROM) add(piece.id, where)
  }
  return made
}
