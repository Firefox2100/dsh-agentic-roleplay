import { LORE_KINDS, LORE_SCOPES, type LoreKind } from 'dsh-roleplay-model'
import type { LorebookEntry } from '../../shared/lorebooks.ts'
import { ImportCardError } from './card.ts'
import { cleanText, partsOf, withPlayer } from './items.ts'
import { mapLimit, slug, uniqueKey, type ImportContext } from './run.ts'

/** One entry of a SillyTavern lorebook, as the importer reads it. */
export interface StEntry {
  /** Its position in the file, which is how the model names it. */
  ref: number
  title: string
  keys: string[]
  text: string
}

export interface StLorebook {
  name: string
  entries: StEntry[]
}

const MAX_ENTRIES = 500
const BATCH_CHARS = 6000
const BATCH_ENTRIES = 8
/** The stand-in for the character a card's lorebook speaks of: a lorebook on its own belongs to no character. */
const CHARACTER_WORD = 'the character'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : [])) : typeof value === 'string' && value.trim() !== '' ? value.split(',').map(entry => entry.trim()).filter(entry => entry !== '') : [])

/** The book of a file: a lorebook export (`entries`), a card (`data.character_book` or `character_book`), or a bare book. */
function bookOf(root: Json): Json | undefined {
  if (isObject(root['entries']) || Array.isArray(root['entries'])) return root
  const data = isObject(root['data']) ? root['data'] : undefined
  const embedded = data?.['character_book'] ?? root['character_book']
  return isObject(embedded) ? embedded : undefined
}

/**
 * Reads a lorebook file. Entries that are switched off or empty are left out; macros of the tool that wrote them are replaced.
 * @throws {ImportCardError} when the file is not a lorebook, with why.
 */
export function readLorebook(file: Buffer, fileName: string): StLorebook {
  let root: unknown
  try { root = JSON.parse(file.toString('utf8').replace(/^﻿/, '')) } catch { throw new ImportCardError('the file is not JSON: a lorebook is the .json file SillyTavern exports') }
  if (!isObject(root)) throw new ImportCardError('the file is not a lorebook: it must be a JSON object')
  const book = bookOf(root)
  if (book === undefined) throw new ImportCardError('the file holds no lorebook: it needs an "entries" list (or a card with a character book)')
  const raw = Array.isArray(book['entries']) ? book['entries'] : isObject(book['entries']) ? Object.values(book['entries']) : []
  const entries: StEntry[] = []
  for (const entry of raw) {
    if (!isObject(entry)) continue
    if (entry['disable'] === true || entry['enabled'] === false) continue
    const content = cleanText(text(entry['content']), CHARACTER_WORD)
    if (content === '') continue
    const keys = [...strings(entry['keys']), ...strings(entry['key'])]
    entries.push({ ref: entries.length, title: text(entry['comment']) || text(entry['name']), keys, text: content })
  }
  if (entries.length === 0) throw new ImportCardError('the lorebook has no entries that are switched on and hold text')
  if (entries.length > MAX_ENTRIES) throw new ImportCardError(`the lorebook has ${entries.length} entries; this importer takes at most ${MAX_ENTRIES}`)
  const title = text(book['name']) || text(root['name'])
  return { name: title === '' ? fileName.replace(/\.json$/i, '') : title, entries }
}

/** Where a piece of steering text goes: the prose prompts, and the prompts that tell the models how to run the game. */
export const STEERING_TARGETS = { style: 'roleplay/style', 'character-style': 'roleplay/character-style', persona: 'roleplay/persona', 'game-master': 'roleplay/game-master', 'character-rules': 'roleplay/character-rules' } as const
export type SteeringTarget = keyof typeof STEERING_TARGETS
export const isSteeringTarget = (value: string): value is SteeringTarget => Object.hasOwn(STEERING_TARGETS, value)
const RULES_TARGETS: readonly SteeringTarget[] = ['game-master', 'character-rules']
/** Whether writing to the prompt changes how the models are told to run the game, not only how the story reads. */
export const isRulesTarget = (target: SteeringTarget): boolean => RULES_TARGETS.includes(target)

const DECISIONS_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer', description: 'The number of the entry, as given.' },
          role: { type: 'string', enum: ['knowledge', 'steering', 'skip'], description: 'knowledge: facts about the world. steering: instructions to the AI about how to write or run the story. skip: neither, or nothing usable.' },
          title: { type: 'string', description: 'For knowledge: a short title (the entry\'s own when it is good). Empty otherwise.' },
          kind: { type: 'string', enum: [...LORE_KINDS], description: 'For knowledge: what kind of fact it is. Use other when none fits.' },
          summary: { type: 'string', description: 'For knowledge: one sentence saying what the entry tells. Empty otherwise.' },
          scope: { type: 'string', enum: [...LORE_SCOPES], description: 'For knowledge: everyone, unless the entry itself clearly says that only some characters know it; then listed.' },
          known_by: { type: 'array', items: { type: 'string' }, description: 'When scope is listed: the characters that know it, as the entry names them. Empty otherwise.' },
          target: { type: 'string', enum: [...Object.keys(STEERING_TARGETS), ''], description: 'For steering: where it belongs. Empty otherwise.' },
          guidance: { type: 'string', description: 'For steering: the instruction, as short direct guidance to the AI in the entry\'s own language, keeping everything it asks for. Empty otherwise.' },
        },
        // every field is required (empty when it does not apply): models leave optional fields out, and with them the scope an entry states
        required: ['ref', 'role', 'title', 'kind', 'summary', 'scope', 'known_by', 'target', 'guidance'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
} as const

interface Decision { ref: number; role: 'knowledge' | 'steering' | 'skip'; title: string; kind: string; summary: string; scope: string; known_by: string[]; target: string; guidance: string }

/** What a batch of entries becomes: facts as lorebook entries, instructions as text for a prompt. */
export interface Classified {
  entries: LorebookEntry[]
  /** Guidance by prompt, the instructions that were not facts. */
  steering: Partial<Record<SteeringTarget, string[]>>
  notes: string[]
}

/** Groups entries into calls: a few at a time, within a budget of text, so that each answer is small and each entry gets attention. */
export function batchesOf(entries: readonly StEntry[]): StEntry[][] {
  const batches: StEntry[][] = []
  let current: StEntry[] = []
  let size = 0
  for (const entry of entries) {
    if (current.length > 0 && (current.length >= BATCH_ENTRIES || size + entry.text.length > BATCH_CHARS)) { batches.push(current); current = []; size = 0 }
    current.push(entry)
    size += entry.text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function problemOf(answer: { entries?: Decision[] }, batch: readonly StEntry[]): string | undefined {
  const given = answer.entries ?? []
  const wanted = new Set(batch.map(entry => entry.ref))
  const seen = new Set<number>()
  for (const decision of given) {
    if (!wanted.has(decision.ref)) return `entry ${decision.ref} was not given; the entries are ${[...wanted].join(', ')}`
    if (seen.has(decision.ref)) return `entry ${decision.ref} is decided twice`
    seen.add(decision.ref)
    if (decision.role === 'knowledge' && text(decision.title) === '' && batch.find(entry => entry.ref === decision.ref)?.title === '') return `entry ${decision.ref} is knowledge and has no title: give it one`
    if (decision.role === 'knowledge' && decision.scope === 'listed' && strings(decision.known_by).length === 0) return `entry ${decision.ref} is listed but names nobody who knows it: use everyone, or name them`
    if (decision.role === 'steering' && (!isSteeringTarget(text(decision.target)) || text(decision.guidance) === '')) return `entry ${decision.ref} is steering: say where it belongs (${Object.keys(STEERING_TARGETS).join(', ')}) and give the guidance`
  }
  const missing = batch.filter(entry => !seen.has(entry.ref)).map(entry => entry.ref)
  return missing.length === 0 ? undefined : `decide every entry: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`
}

const describe = (entry: StEntry): string => `Entry ${entry.ref}${entry.title === '' ? '' : ` “${entry.title}”`}${entry.keys.length === 0 ? '' : ` (triggers: ${entry.keys.join(', ')})`}:\n${entry.text}`

/**
 * Sorts the entries of a lorebook into what the world is (kept word for word as lorebook entries, common knowledge unless an entry clearly says otherwise)
 * and what is told to the AI (kept as guidance for the prompts). Throws when the model never gives a usable answer, so that nothing half-made is written.
 */
export async function classifyEntries(ctx: ImportContext, book: StLorebook): Promise<Classified> {
  const batches = batchesOf(book.entries)
  ctx.say(`sorting ${book.entries.length} entries`)
  const answers = await mapLimit(batches, ctx.concurrency, async (batch) => {
    return await ctx.run<{ entries: Decision[] }>({
      persona: ctx.text('import/lorebook'),
      prompt: `Lorebook: ${book.name}\n\n${batch.map(describe).join('\n\n---\n\n')}`,
      result: DECISIONS_SCHEMA as never,
      check: value => problemOf(value, batch),
    })
  })
  const result: Classified = { entries: [], steering: {}, notes: [] }
  const taken = new Set<string>()
  for (const [index, batch] of batches.entries()) {
    const decisions = new Map(answers[index]!.entries.map(decision => [decision.ref, decision]))
    for (const source of batch) {
      const decision = decisions.get(source.ref)!
      const label = source.title === '' ? `entry ${source.ref}` : `“${source.title}”`
      if (decision.role === 'skip') { result.notes.push(`left out: ${label}`); continue }
      if (decision.role === 'steering') {
        const target = text(decision.target) as SteeringTarget
        ;(result.steering[target] ??= []).push(withPlayer(text(decision.guidance)))
        continue
      }
      const title = (text(decision.title) || source.title).slice(0, 100)
      const kind: LoreKind = LORE_KINDS.includes(decision.kind as LoreKind) ? decision.kind as LoreKind : 'other'
      const listed = decision.scope === 'listed' && strings(decision.known_by).length > 0
      const also = source.keys.length === 0 ? '' : ` Also: ${source.keys.join(', ')}.`
      const parts = partsOf(withPlayer(source.text))
      for (const [part, body] of parts.entries()) {
        result.entries.push({
          id: uniqueKey(slug(title, 'entry'), taken), title: parts.length === 1 ? title : `${title} (${part + 1})`, kind, scope: listed ? 'listed' : 'everyone', knownBy: listed ? strings(decision.known_by) : [],
          summary: `${text(decision.summary)}${part === 0 ? also : ''}`.trim(), body, related: [],
        })
      }
    }
  }
  return result
}
