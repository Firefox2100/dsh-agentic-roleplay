import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { ImportChoices, NormalizedCard } from '../../shared/import-card.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import type { ImportReport } from './finish.ts'
import { sourcesFor } from './extract.ts'
import { itemise } from './items.ts'
import { norm } from './run.ts'
import { IMPORT_FOLDER, readImportFolder } from './store.ts'
import { findEntity, type Classified, type Roster } from './survey.ts'

type AgentExec = { agent?: { session: { id: string } } }

/** The most of a piece one `card_read` returns; a long lorebook entry is read in turns. */
export const READ_CHARS = 6000
const SNIPPET_CHARS = 240
const DEFAULT_HITS = 8
const MAX_HITS = 20

/** One thing the card says, whole: a field, a greeting, or a lorebook entry. */
export interface CardPiece {
  /** The id the import gave it (`field:description`, `entry:3`); a long piece the import read in parts is still one piece here. */
  id: string
  label: string
  title: string
  keys: string[]
  text: string
  /** Whether the import read it for the world; the instructions, the creator's notes and the entries left off are kept but were not. */
  used: boolean
  /** A lorebook entry's own switch in the card. */
  enabled?: boolean
}

export const baseId = (id: string): string => id.replace(/#\d+$/, '')

/** The folder inside `.import` where a newer version of the card waits to be applied to the world. */
export const UPDATE_FOLDER = 'update'

/** Which version of the card a tool reads: the one the world was made from, or the newer one that is waiting to update it. */
export type CardVersion = 'current' | 'new'

/** Everything the card holds, in the order the card has it. */
export function cardPieces(card: NormalizedCard, choices: ImportChoices): CardPiece[] {
  const read = new Set(itemise(card, choices).map(item => baseId(item.id)))
  const field = (id: string, label: string, text: string): CardPiece[] => (text.trim() === '' ? [] : [{ id, label, title: '', keys: [], text, used: read.has(id) }])
  return [
    ...field('field:description', 'description', card.description),
    ...field('field:personality', 'personality', card.personality),
    ...field('field:scenario', 'scenario', card.scenario),
    ...field('field:example', 'example messages', card.messageExample),
    ...field('field:first-message', 'first message', card.firstMessage),
    ...card.alternateGreetings.flatMap((text, index) => field(`field:greeting-${index + 1}`, `alternate greeting ${index + 1}`, text)),
    ...field('field:creator-notes', 'creator\'s notes', card.creatorNotes),
    ...field('field:system-prompt', 'system prompt', card.systemPrompt),
    ...field('field:post-history', 'post-history instructions', card.postHistoryInstructions),
    ...(card.book?.entries ?? []).filter(entry => entry.content.trim() !== '').map(entry => ({
      id: entry.id, label: entry.title === '' ? entry.id : `entry “${entry.title}”`, title: entry.title, keys: entry.keys, text: entry.content, used: read.has(entry.id), enabled: entry.enabled,
    })),
  ]
}

/** What the importer worked out, when it got that far; each part is absent when its file is. */
export interface Records {
  classified?: Classified | undefined
  roster?: Roster | undefined
  report?: ImportReport | undefined
}

async function optional<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export interface Source {
  card: NormalizedCard
  choices: ImportChoices
  pieces: CardPiece[]
  records: Records
}

/** The card kept in a world's import folder, and what the import made of it. The tools exist as long as the card does. */
export async function readSource(directory: string, withRecords: boolean, version: CardVersion = 'current'): Promise<Source> {
  const folder = join(directory, IMPORT_FOLDER)
  let read: Awaited<ReturnType<typeof readImportFolder>>
  try { read = await readImportFolder(version === 'new' ? join(folder, UPDATE_FOLDER) : folder) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(version === 'new' ? 'no newer version of the card is waiting to update this world' : 'this world has no source card: it was not imported from one, or its .import folder was removed')
    throw error
  }
  const records: Records = withRecords && version === 'current' ? { classified: await optional<Classified>(join(folder, 'classification.json')), roster: await optional<Roster>(join(folder, 'roster.json')), report: await optional<ImportReport>(join(folder, 'report.json')) } : {}
  return { card: read.card, choices: read.choices, pieces: cardPieces(read.card, read.choices), records }
}

export const rolesOf = (classified: Classified | undefined, id: string): string[] => {
  if (classified === undefined) return []
  return [...new Set(Object.entries(classified).filter(([key]) => baseId(key) === id).flatMap(([, entry]) => entry.roles))]
}

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - Math.floor((SNIPPET_CHARS - length) / 2))
  const end = Math.min(text.length, start + SNIPPET_CHARS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

/** The pieces that contain the query as a phrase or, failing that, any of its words; the best first, with where it was found: in the text, or only in the title and keys of an entry. */
export interface Hit { piece: CardPiece; matches: number; in: 'text' | 'title or keys'; snippet: string }

export function searchPieces(pieces: readonly CardPiece[], query: string, limit: number): Hit[] {
  const phrase = query.trim().toLowerCase()
  if (phrase === '') return []
  const words = [...new Set(phrase.split(/[\s,;，、]+/).filter(word => word.length >= (/^[\x00-\x7f]+$/.test(word) ? 3 : 2)))]
  const count = (text: string, needle: string): { n: number; first: number } => {
    let n = 0
    let first = -1
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) { n += 1; if (first < 0) first = at }
    return { n, first }
  }
  const look = (text: string): { matches: number; score: number; at: number; length: number } | undefined => {
    const lowered = text.toLowerCase()
    const whole = count(lowered, phrase)
    if (whole.n > 0) return { matches: whole.n, score: whole.n * 4 + 100, at: whole.first, length: phrase.length }
    const found = words.map(word => ({ word, ...count(lowered, word) })).filter(entry => entry.n > 0)
    if (found.length === 0) return undefined
    const best = found.reduce((a, b) => (a.first <= b.first ? a : b), found[0]!)
    return { matches: found.reduce((sum, entry) => sum + entry.n, 0), score: found.length * 10 + found.reduce((sum, entry) => sum + entry.n, 0), at: best.first, length: best.word.length }
  }
  const scored = pieces.flatMap((piece): (Hit & { score: number })[] => {
    const inText = look(piece.text)
    if (inText !== undefined) return [{ piece, in: 'text', matches: inText.matches, score: inText.score, snippet: snippet(piece.text, inText.at, inText.length) }]
    const head = [piece.title, ...piece.keys].filter(part => part !== '').join(' · ')
    const inHead = look(head)
    return inHead === undefined ? [] : [{ piece, in: 'title or keys', matches: inHead.matches, score: inHead.score - 50, snippet: `${piece.title === '' ? '' : `title: ${piece.title}`}${piece.keys.length === 0 ? '' : `${piece.title === '' ? '' : '; '}keys: ${piece.keys.join(', ')}`}` }]
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ piece, matches, in: where, snippet: text }) => ({ piece, matches, in: where, snippet: text }))
}

const versionParameter = { type: 'string' as const, enum: ['current', 'new'], description: 'current (the default) is the card the world was made from; new is the newer version waiting to update it, when card_diff says there is one. Piece ids are those of that version.' }

const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never
const idOf = (exec: AgentExec): string => {
  const chat = exec.agent?.session.id
  const world = chat === undefined ? undefined : authoredWorldOf(chat)
  if (world === undefined) throw new Error('this tool is available only in a world authoring chat')
  return world
}

/**
 * Read-only tools over the card a world was imported from, which stays in the world's `.import` folder: they work while that folder holds the card and say so when it does not.
 * `records` adds what the import made of the card (the role of each piece, who it was used for); it is off only when a test compares the agent with and without it.
 */
export function cardTools(worlds: WorldCatalog, options: { records?: boolean } = {}): ToolDefinition[] {
  const withRecords = options.records !== false
  const source = async (exec: AgentExec, version: CardVersion = 'current'): Promise<Source> => {
    const id = idOf(exec)
    const record = await worlds.find(id)
    if (record === undefined) throw new Error(`the authored world "${id}" no longer exists`)
    return await readSource(record.directory, withRecords, version)
  }
  const versionOf = (value: unknown): CardVersion => {
    if (value === undefined || value === 'current') return 'current'
    if (value === 'new') return 'new'
    throw new Error('version must be current or new')
  }
  const find = (pieces: readonly CardPiece[], id: string): CardPiece => {
    const found = pieces.find(piece => piece.id === id)
    if (found === undefined) throw new Error(`the card has no piece "${id}": use an id from card_overview or card_search`)
    return found
  }
  return [
    defineTool({
      name: 'card_overview',
      description: 'The card this world was imported from, which is kept: its name, creator and tags, every piece of it (field, greeting or lorebook entry) with its size, and, from the import\'s own records, what each piece was taken to be and which characters, places and things were made from it. Start here when the person asks where something in the world came from.',
      parameters: {},
      output,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { card, choices, pieces, records } = await source(exec)
        const madeFrom = entitiesByPiece({ card, choices, pieces, records })
        const made = (id: string): string[] => madeFrom.get(id) ?? []
        return json({
          card: { name: card.name, creator: card.creator, version: card.characterVersion, tags: card.tags, format: card.sourceSpec, ignoredScripts: card.ignored.scripts },
          pieces: pieces.map(piece => ({
            id: piece.id, label: piece.label, characters: piece.text.length, readByTheImport: piece.used,
            ...(piece.enabled === undefined ? {} : { switchedOnInCard: piece.enabled }),
            ...(withRecords ? { takenToBe: rolesOf(records.classified, piece.id), madeInto: made(piece.id) } : {}),
          })),
          ...(records.roster === undefined ? {} : { imported: records.roster.map(entity => ({ name: entity.name, kind: entity.kind, aliases: entity.aliases, playedByThePlayer: entity.player })) }),
          ...(records.report === undefined ? {} : { importNotes: records.report.notes, leftOut: records.report.leftOut }),
          note: 'The import\'s records are its own judgement and can be wrong or incomplete; check them against the text of the piece with card_read.',
        })
      },
    }),
    defineTool({
      name: 'card_search',
      description: 'Searches everything the card says (fields, greetings, lorebook entries and their keys) for a name or phrase and returns the pieces that contain it, best first, each with a short snippet and whether it was found in the text or only in the title or keys of an entry. A hit is a pointer, not evidence: read the piece with card_read before you answer from it.',
      parameters: { query: { type: 'string', required: true, description: 'A name or phrase to look for, in the card\'s own language.' }, version: versionParameter, limit: { type: 'number', description: `How many pieces to return, at most ${MAX_HITS} (default ${DEFAULT_HITS}).` } },
      output,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { pieces } = await source(exec, versionOf(args.version))
        const limit = Math.min(MAX_HITS, Math.max(1, Math.floor(typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_HITS)))
        const hits = searchPieces(pieces, args.query, limit)
        return json({ query: args.query, found: hits.length, hits: hits.map(({ piece, matches, in: where, snippet: text }) => ({ piece: piece.id, label: piece.label, matches, foundIn: where, snippet: text })) })
      },
    }),
    defineTool({
      name: 'card_read',
      description: `The text of one piece of the card, word for word as the card has it (the card's own placeholders such as {{user}} included). A long piece is read in turns of ${READ_CHARS} characters: when "next" is given, call again with that offset.`,
      parameters: { piece: { type: 'string', required: true, description: 'A piece id from card_overview, card_search or card_diff, such as field:description or entry:3.' }, version: versionParameter, offset: { type: 'number', description: 'Where to start reading, in characters (default 0).' } },
      output,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { pieces } = await source(exec, versionOf(args.version))
        const piece = find(pieces, args.piece)
        const from = Math.min(piece.text.length, Math.max(0, Math.floor(typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0)))
        const to = Math.min(piece.text.length, from + READ_CHARS)
        return json({ piece: piece.id, label: piece.label, ...(piece.keys.length === 0 ? {} : { keys: piece.keys }), from, to, of: piece.text.length, ...(to < piece.text.length ? { next: to } : {}), text: piece.text.slice(from, to) })
      },
    }),
    defineTool({
      name: 'card_origin',
      description: 'Where a character, place, organisation or thing of this world came from: the pieces of the card the import read to make it (the pieces about it first, then those that only mention it), with what each was taken to be. For a name the import did not make anything of, the pieces of the card that mention it. Then read the pieces with card_read to answer from their text.',
      parameters: { name: { type: 'string', required: true, description: 'The name or an alias, as the world or the card has it.' } },
      output,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { card, choices, pieces, records } = await source(exec)
        const entity = records.roster === undefined ? undefined : findEntity(records.roster, args.name)
        if (entity === undefined || records.classified === undefined) {
          return json({ name: args.name, madeByTheImport: false, mentions: searchPieces(pieces, args.name, DEFAULT_HITS).map(({ piece, in: where, snippet: text }) => ({ piece: piece.id, label: piece.label, foundIn: where, snippet: text })) })
        }
        return json({ name: entity.name, kind: entity.kind, aliases: entity.aliases, madeByTheImport: true, usedPieces: originOf(card, choices, pieces, records, entity.name).map(entry => ({ piece: entry.piece, label: entry.label, how: entry.how, takenToBe: rolesOf(records.classified, entry.piece) })) })
      },
    }),
  ]
}

/** For each piece of the card, the names of the characters, places and things the import made from it. */
export function entitiesByPiece(source: Source): Map<string, string[]> {
  const made = new Map<string, string[]>()
  for (const entity of source.records.roster ?? []) for (const entry of originOf(source.card, source.choices, source.pieces, source.records, entity.name)) made.set(entry.piece, [...(made.get(entry.piece) ?? []), entity.name])
  return made
}

/** The pieces an entity was made from, as the build chose them: the ones the survey said are about it, then those that name it. */
export function originOf(card: NormalizedCard, choices: ImportChoices, pieces: readonly CardPiece[], records: Records, name: string): { piece: string; label: string; how: 'about it' | 'mentions it' }[] {
  if (records.roster === undefined || records.classified === undefined) return []
  const entity = findEntity(records.roster, name)
  if (entity === undefined) return []
  const names = [entity.name, ...entity.aliases].map(norm)
  const items = itemise(card, choices)
  const chosen = sourcesFor(entity, items, records.classified)
  const about = (id: string): boolean => (records.classified?.[id]?.targets ?? []).some(target => target.kind === entity.kind && names.includes(norm(target.name)))
  const seen = new Set<string>()
  return chosen.flatMap((item) => {
    const id = baseId(item.id)
    const piece = pieces.find(entry => entry.id === id)
    if (piece === undefined || seen.has(id)) return []
    seen.add(id)
    return [{ piece: id, label: piece.label, how: about(item.id) ? 'about it' as const : 'mentions it' as const }]
  })
}
