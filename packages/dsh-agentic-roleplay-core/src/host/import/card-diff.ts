import type { ImportChoices, NormalizedCard } from '../../shared/import-card.ts'
import type { CardPiece } from './card-tools.ts'
import { alternateOpenings, openingMessage } from './finish.ts'
import { openingText } from './store.ts'

/** A pair of pieces of two versions of a card that are the same thing. */
export interface PiecePair { before: CardPiece; after: CardPiece }

export interface PieceMatch {
  /** In both versions, whatever became of the text. */
  pairs: PiecePair[]
  added: CardPiece[]
  removed: CardPiece[]
}

/** One place where the text changed: what was there, and what is there now. */
export interface Hunk {
  /** The sentence before, for orientation. */
  after?: string
  removed: string
  added: string
}

const MAX_SEGMENTS = 1500
const MAX_HUNK_CHARS = 700
/** Entries that kept neither their title nor their keys count as the same one only when this much of their words is shared. */
const SAME_ENTRY = 0.5

const normalised = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const entryHead = (piece: CardPiece): string => normalised([piece.title, ...piece.keys].join('|'))
const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])

function overlap(a: string, b: string): number {
  const first = words(a)
  const second = words(b)
  if (first.size === 0 && second.size === 0) return 1
  let shared = 0
  for (const word of first) if (second.has(word)) shared += 1
  return shared / (first.size + second.size - shared)
}

/**
 * Which piece of the old card is which piece of the new one. Fields and greetings are the same by their id; lorebook entries are numbered by position, which an edit
 * shifts, so they are found by what they are called and keyed on, then by their text, and only then by the number.
 */
export function matchPieces(before: readonly CardPiece[], after: readonly CardPiece[]): PieceMatch {
  const pairs: PiecePair[] = []
  const left = new Map(before.map(piece => [piece.id, piece]))
  const right = new Map(after.map(piece => [piece.id, piece]))
  const pair = (a: CardPiece, b: CardPiece): void => { pairs.push({ before: a, after: b }); left.delete(a.id); right.delete(b.id) }
  const isEntry = (piece: CardPiece): boolean => piece.id.startsWith('entry:')
  for (const piece of before) {
    const other = right.get(piece.id)
    if (!isEntry(piece) && other !== undefined) pair(piece, other)
  }
  const unmatched = (map: Map<string, CardPiece>): CardPiece[] => [...map.values()].filter(isEntry)
  for (const keyOf of [entryHead, (piece: CardPiece) => normalised(piece.text)]) {
    const taken = new Set<string>()
    for (const piece of unmatched(left)) {
      const key = keyOf(piece)
      if (key === '' || key === '|') continue
      const candidates = unmatched(right).filter(other => !taken.has(other.id) && keyOf(other) === key)
      const same = candidates.find(other => other.id === piece.id) ?? candidates[0]
      if (same !== undefined) { taken.add(same.id); pair(piece, same) }
    }
  }
  for (const piece of unmatched(left)) {
    const other = right.get(piece.id)
    if (other !== undefined && overlap(piece.text, other.text) >= SAME_ENTRY) pair(piece, other)
  }
  const order = new Map(before.map((piece, index) => [piece.id, index]))
  return { pairs: pairs.sort((a, b) => (order.get(a.before.id) ?? 0) - (order.get(b.before.id) ?? 0)), added: [...right.values()], removed: [...left.values()] }
}

/** The sentences and lines of a text, each with the whitespace that follows it, so that joining them gives the text back. */
function segments(text: string): string[] {
  const parts: string[] = []
  const endings = '.!?。！？\n'
  let start = 0
  let at = 0
  while (at < text.length) {
    if (!endings.includes(text[at]!)) { at += 1; continue }
    while (at < text.length && endings.includes(text[at]!)) at += 1
    while (at < text.length && /\s/u.test(text[at]!)) at += 1
    parts.push(text.slice(start, at))
    start = at
  }
  if (start < text.length) parts.push(text.slice(start))
  return parts
}

const shorten = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= MAX_HUNK_CHARS ? clean : `${clean.slice(0, MAX_HUNK_CHARS)}…`
}

/** Where two versions of a text differ, sentence by sentence; nothing when they are the same, and undefined when the texts are too long to compare (read both then). */
export function diffText(before: string, after: string): Hunk[] | undefined {
  if (before === after) return []
  const a = segments(before).map(part => part.trim())
  const b = segments(after).map(part => part.trim())
  if (a.length > MAX_SEGMENTS || b.length > MAX_SEGMENTS) return undefined
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let last: string | undefined
  let removed: string[] = []
  let added: string[] = []
  let before_: string | undefined
  const close = (): void => {
    if (removed.length + added.length === 0) return
    hunks.push({ ...(before_ === undefined ? {} : { after: shorten(before_) }), removed: shorten(removed.join(' ')), added: shorten(added.join(' ')) })
    removed = []
    added = []
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { close(); last = a[i]; before_ = last; i += 1; j += 1; continue }
    if (removed.length + added.length === 0) before_ = last
    if (j < b.length && (i === a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) { added.push(b[j]!); j += 1 } else { removed.push(a[i]!); i += 1 }
  }
  close()
  return hunks
}

/** What differs in what the card says about itself rather than in its pieces. */
export function cardChanges(before: NormalizedCard, after: NormalizedCard): string[] {
  const lines: string[] = []
  const compare = (label: string, a: string, b: string): void => { if (a !== b) lines.push(`${label}: “${shorten(a)}” → “${shorten(b)}”`) }
  compare('name', before.name, after.name)
  compare('creator', before.creator, after.creator)
  compare('version', before.characterVersion, after.characterVersion)
  compare('tags', before.tags.join(', '), after.tags.join(', '))
  return lines
}

/** A field of what the world says about itself that a newer card gives reason to change. */
export interface WorldFieldChange {
  field: 'description' | 'tags' | 'opening' | 'alternateOpenings' | 'authorName'
  because: string
  /** What the import would write in the field for the new card, when that is not a matter of judgement: the greetings as plain paragraphs. */
  suggested?: unknown
}

/** What the newer card changes that the world keeps in its own file (the fields edit_world_info sets) rather than in a character, place, thing or entry. */
export function worldFieldChanges(before: { card: NormalizedCard; choices: ImportChoices }, after: { card: NormalizedCard; choices: ImportChoices }): WorldFieldChange[] {
  const changes: WorldFieldChange[] = []
  const differ = (a: string, b: string): boolean => a.trim() !== b.trim()
  if (differ(before.card.description, after.card.description) || differ(before.card.scenario, after.card.scenario) || differ(before.card.creatorNotes, after.card.creatorNotes)) {
    changes.push({ field: 'description', because: 'the card\'s description, scenario or creator\'s notes changed, and the world\'s description summarises them' })
  }
  if (before.card.tags.join('\n') !== after.card.tags.join('\n')) changes.push({ field: 'tags', because: `the card\'s tags are now: ${after.card.tags.join(', ') || '(none)'}; the world\'s tags follow them, and you add none of your own` })
  if (differ(before.card.creator, after.card.creator)) changes.push({ field: 'authorName', because: `the card\'s creator is now “${after.card.creator}”` })
  if (differ(openingText(before.card, before.choices.opening) ?? '', openingText(after.card, after.choices.opening) ?? '')) changes.push({ field: 'opening', because: 'the greeting the world opens with changed; suggested is the new greeting as the import writes an opening (plain paragraphs, the card\'s markup removed, the player named by the world\'s player character where the card says {{user}})', suggested: openingMessage(openingText(after.card, after.choices.opening) ?? '', after.card.name) })
  if (JSON.stringify(alternateOpenings(before.card, before.choices.opening)) !== JSON.stringify(alternateOpenings(after.card, after.choices.opening))) changes.push({ field: 'alternateOpenings', because: 'the card\'s other greetings changed; suggested is the whole list as the import writes it', suggested: alternateOpenings(after.card, after.choices.opening) })
  return changes
}
