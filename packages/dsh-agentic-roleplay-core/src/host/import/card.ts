import { inflateSync } from 'node:zlib'
import type { CardEntry, NormalizedCard } from '../../shared/import-card.ts'
import { trimCharacters } from '../../shared/text.ts'

/** The file is not a character card this importer reads. The message says why, for the person who uploaded it. */
export class ImportCardError extends Error {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt'])
/** The keywords a card's data is stored under, the newer one first. */
const CARD_KEYWORDS = ['ccv3', 'chara']

interface Chunk {
  type: string
  data: Buffer
  /** The chunk as it is in the file: length, type, data and checksum. */
  raw: Buffer
}

function chunksOf(file: Buffer): Chunk[] {
  const chunks: Chunk[] = []
  let at = PNG_SIGNATURE.length
  while (at + 12 <= file.length) {
    const length = file.readUInt32BE(at)
    const end = at + 12 + length
    if (end > file.length) throw new ImportCardError('the PNG file is damaged: a part of it is cut off')
    chunks.push({ type: file.toString('latin1', at + 4, at + 8), data: file.subarray(at + 8, at + 8 + length), raw: file.subarray(at, end) })
    at = end
  }
  return chunks
}

/** The keyword and text of a PNG text chunk. */
function textOf(chunk: Chunk): { keyword: string; text: string } | undefined {
  const end = chunk.data.indexOf(0)
  if (end < 0) return undefined
  const keyword = chunk.data.toString('latin1', 0, end)
  const rest = chunk.data.subarray(end + 1)
  if (chunk.type === 'tEXt') return { keyword, text: rest.toString('latin1') }
  if (chunk.type === 'zTXt') return { keyword, text: inflateSync(rest.subarray(1)).toString('latin1') }
  const compressed = rest[0] === 1
  let from = 2
  for (let skipped = 0; skipped < 2; skipped += 1) from = rest.indexOf(0, from) + 1
  if (from <= 0) return undefined
  const body = rest.subarray(from)
  return { keyword, text: (compressed ? inflateSync(body) : body).toString('utf8') }
}

/** The PNG without its text chunks: the picture, with none of the card's data in it. */
export function pictureOf(file: Buffer): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunksOf(file).filter(chunk => !TEXT_CHUNKS.has(chunk.type)).map(chunk => chunk.raw)])
}

function jsonOf(file: Buffer, name: string): unknown {
  if (file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    const found = new Map<string, string>()
    for (const chunk of chunksOf(file)) {
      if (!TEXT_CHUNKS.has(chunk.type)) continue
      const text = textOf(chunk)
      if (text !== undefined && CARD_KEYWORDS.includes(text.keyword) && !found.has(text.keyword)) found.set(text.keyword, text.text)
    }
    const keyword = CARD_KEYWORDS.find(candidate => found.has(candidate))
    if (keyword === undefined) throw new ImportCardError(`${name} is a PNG picture with no character card in it`)
    try {
      return JSON.parse(Buffer.from(found.get(keyword)!.trim(), 'base64').toString('utf8'))
    } catch {
      throw new ImportCardError(`the card data in ${name} is not readable`)
    }
  }
  try {
    return JSON.parse(file.toString('utf8').replace(/^﻿/, ''))
  } catch {
    throw new ImportCardError(`${name} is neither a PNG picture with a card in it nor a JSON card`)
  }
}

const URL_PATTERN = /https?:\/\/[^\s"'`<>()[\]{}\\|^]+/gi

/** Every web address in the strings of a document, at any depth; template placeholders and trailing punctuation are not part of one. */
export function urlsOf(value: unknown): string[] {
  const found = new Set<string>()
  const visit = (node: unknown, depth: number): void => {
    if (depth > 32) return
    if (typeof node === 'string') {
      for (const match of node.matchAll(URL_PATTERN)) {
        const url = trimCharacters(match[0], '.,;:!?*_~', 'end')
        if (!url.includes('$') && url.length <= 2000) found.add(url)
      }
    } else if (Array.isArray(node)) for (const entry of node) visit(entry, depth + 1)
    else if (typeof node === 'object' && node !== null) for (const entry of Object.values(node)) visit(entry, depth + 1)
  }
  visit(value, 0)
  return [...found]
}

const object = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined)
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' ? [entry] : typeof entry === 'number' ? [String(entry)] : [])) : [])

function entryOf(value: unknown, index: number): CardEntry | undefined {
  const entry = object(value)
  if (entry === undefined) return undefined
  const position = entry['position']
  return {
    id: `entry:${index}`,
    title: text(entry['comment']).trim() || text(entry['name']).trim(),
    keys: texts(entry['keys']),
    secondaryKeys: texts(entry['secondary_keys']),
    content: text(entry['content']),
    enabled: entry['enabled'] !== false,
    constant: entry['constant'] === true,
    selective: entry['selective'] === true,
    position: typeof position === 'string' ? position : typeof position === 'number' ? String(position) : '',
  }
}

/**
 * Reads a character card: a PNG with the card in its text chunk (the newer `ccv3` chunk when there is one), or the JSON of a card.
 * Only V2 and V3 cards are read; a V2 card is carried over into the V3 shape, whose fields are a superset.
 * @throws {ImportCardError} when the file is not such a card.
 */
export function readCard(file: Buffer, name: string): NormalizedCard {
  const root = object(jsonOf(file, name))
  const spec = root === undefined ? undefined : root['spec']
  if (spec !== 'chara_card_v2' && spec !== 'chara_card_v3') {
    throw new ImportCardError(spec === undefined ? `${name} is not a V2 or V3 character card (it has no "spec")` : `${name} is a "${text(spec)}" card: only V2 and V3 cards are read`)
  }
  const data = object(root?.['data'])
  if (data === undefined) throw new ImportCardError(`${name} has no card data`)
  const cardName = text(data['name']).trim()
  if (cardName === '') throw new ImportCardError(`${name} has a card with no name`)
  const book = object(data['character_book'])
  const entries = Array.isArray(book?.['entries']) ? (book['entries'] as unknown[]).flatMap((entry, index) => entryOf(entry, index) ?? []) : []
  const extensions = object(data['extensions']) ?? {}
  const scripts = [extensions['regex_scripts'], object(extensions['tavern_helper'])?.['scripts']].reduce<number>((count, list) => count + (Array.isArray(list) ? list.length : 0), 0)
  return {
    sourceSpec: spec,
    name: cardName,
    description: text(data['description']),
    personality: text(data['personality']),
    scenario: text(data['scenario']),
    firstMessage: text(data['first_mes']),
    alternateGreetings: texts(data['alternate_greetings']),
    messageExample: text(data['mes_example']),
    creatorNotes: text(data['creator_notes']),
    systemPrompt: text(data['system_prompt']),
    postHistoryInstructions: text(data['post_history_instructions']),
    tags: texts(data['tags']),
    creator: text(data['creator']),
    characterVersion: text(data['character_version']),
    ...(book === undefined ? {} : { book: { name: text(book['name']), description: text(book['description']), entries } }),
    ignored: { scripts, extensions: Object.keys(extensions).filter(key => !['talkativeness', 'fav', 'world', 'depth_prompt'].includes(key)) },
    urls: urlsOf(data),
  }
}

/** Whether a file looks like a PNG, so that its picture can be kept. */
export const isPng = (file: Buffer): boolean => file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
