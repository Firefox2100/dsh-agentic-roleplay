import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ImportChoices, NormalizedCard } from '../../shared/import-card.ts'
import { CHARACTER_FILE_NAME } from '../characters/character-file.ts'
import { CHARACTERS_DIR } from '../characters/load.ts'
import { FACTION_FILE_NAME } from '../factions/faction-file.ts'
import { FACTIONS_DIR } from '../factions/load.ts'
import { ITEM_FILE_NAME } from '../items/item-file.ts'
import { ITEMS_DIR } from '../items/load.ts'
import { LOCATION_FILE_NAME } from '../locations/location-file.ts'
import { LOCATIONS_DIR } from '../locations/load.ts'
import { LORE_FILE_NAME } from '../lore/lore-file.ts'
import { LORE_DIR } from '../lore/load.ts'
import { InvalidWorldError } from '../sessions/errors.ts'
import { WORLD_FILE_NAME } from '../worlds/world-file.ts'
import { loadValidatedWorld } from '../worlds/validated-world.ts'
import { cleanText, withPlayer, type SourceItem } from './items.ts'
import type { Extracted } from './extract.ts'
import type { ChildJob, ImportContext, TextOf } from './run.ts'
import { IMPORT_FOLDER, PICTURE_FILE, openingText } from './store.ts'
import { isLeftOut, type Classified, type Roster } from './survey.ts'

type Document = Record<string, unknown>

const STAGE = 'stage'
const MAX_DESCRIPTION = 500
const MAX_TAGS = 8
const MAX_TAG = 30

const FOLDERS = [
  { key: 'characters', directory: CHARACTERS_DIR, file: CHARACTER_FILE_NAME },
  { key: 'locations', directory: LOCATIONS_DIR, file: LOCATION_FILE_NAME },
  { key: 'factions', directory: FACTIONS_DIR, file: FACTION_FILE_NAME },
  { key: 'items', directory: ITEMS_DIR, file: ITEM_FILE_NAME },
  { key: 'lore', directory: LORE_DIR, file: LORE_FILE_NAME },
] as const

/** What came of an import, for the person and for the chat that ran it. */
export interface ImportReport {
  counts: { characters: number; places: number; factions: number; things: number; lore: number }
  hasPlayableCharacter: boolean
  opening: 'imported' | 'none'
  cover: boolean
  /** What was read and not carried on, by what it was. */
  leftOut: { instructions: number; templates: number; irrelevant: number; scripts: number }
  /** Things that could not be carried over, each with its reason. */
  notes: string[]
}

/** The card's opening as the world's opening message: plain paragraphs, without the markup the card's tool read as emphasis. */
export function openingMessage(raw: string, cardName: string, player?: string): string {
  const text = cleanText(raw, cardName)
    .replace(/<\/?[a-z][^>\n]*>/gi, '')
    .replace(/```[a-z]*\n?|```/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return withPlayer(text, player)
}

/** Every player marker in the strings of a value, replaced by the player's character or a plain word for the player; the value is changed in place. */
export function replacePlayer(value: unknown, player?: string): void {
  if (Array.isArray(value)) value.forEach((entry, index) => { if (typeof entry === 'string') value[index] = withPlayer(entry, player); else replacePlayer(entry, player) })
  else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) { const entry = record[key]; if (typeof entry === 'string') record[key] = withPlayer(entry, player); else replacePlayer(entry, player) }
  }
}

/** Places that contain each other in a circle are untangled by taking the parent off the one that closes it. */
export function breakParentCircles(locations: Document[]): string[] {
  const notes: string[] = []
  const byId = new Map(locations.map(location => [String(location['id']), location]))
  for (const location of locations) {
    const seen = new Set<string>([String(location['id'])])
    for (let up = location['parent'] as string | undefined; up !== undefined; up = byId.get(up)?.['parent'] as string | undefined) {
      if (seen.has(up)) { notes.push(`${String(location['name'])}: the places contain each other in a circle, so it is not put inside another place`); delete location['parent']; break }
      seen.add(up)
    }
  }
  return notes
}

const WORLD_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: `Two or three sentences, at most ${MAX_DESCRIPTION} characters.` },
    tags: { type: 'array', items: { type: 'string' }, description: `At most ${MAX_TAGS} short tags.` },
    starting_time: { type: 'string', description: 'When the story begins, as an ISO 8601 date and time such as 1921-10-23T08:00:00, only when the text states the date or year; otherwise an empty string.' },
  },
  required: ['description', 'tags', 'starting_time'],
  additionalProperties: false,
} as const

interface WorldAnswer { description: string; tags: string[]; starting_time: string }

const STARTING_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/

function worldJob(text: TextOf, card: NormalizedCard, roster: Roster, scenario: string, opening: string): ChildJob<WorldAnswer> {
  const names = (kind: string): string => roster.filter(entity => entity.kind === kind).slice(0, 15).map(entity => entity.name).join('; ')
  return {
    persona: text('import/world-summary'),
    prompt: [`Card: ${card.name}`, ...(card.tags.length === 0 ? [] : [`Card tags: ${card.tags.join(', ')}`]), `Characters: ${names('character') || '(none)'}`, `Places: ${names('place') || '(none)'}`,
      `Scenario:\n${scenario.slice(0, 1200) || '(none)'}`, `Opening:\n${opening.slice(0, 1200) || '(none)'}`, `Description:\n${cleanText(card.description, card.name).slice(0, 1200) || '(none)'}`, `Creator's notes:\n${cleanText(card.creatorNotes, card.name).slice(0, 600) || '(none)'}`].join('\n\n'),
    result: WORLD_SCHEMA as never,
    check: (value) => {
      if (value.description.trim() === '' || value.description.length > MAX_DESCRIPTION) return `the description must be written and at most ${MAX_DESCRIPTION} characters`
      if (value.tags.length > MAX_TAGS || value.tags.some(tag => tag.trim() === '' || tag.length > MAX_TAG)) return `give at most ${MAX_TAGS} tags of at most ${MAX_TAG} characters`
      if ((value.starting_time ?? '').trim() !== '' && (!STARTING_TIME.test(value.starting_time.trim()) || Number.isNaN(Date.parse(value.starting_time.trim())))) return 'starting_time must be an ISO 8601 date and time such as 1921-10-23T08:00:00, or empty'
      return undefined
    },
  }
}

/** The description and tags of the world: asked of one call, and from the card's own fields when that fails. */
export async function describeWorld(ctx: ImportContext, card: NormalizedCard, roster: Roster, items: readonly SourceItem[], opening: string): Promise<{ description: string; tags: string[]; startingTime?: string; note?: string }> {
  const scenario = items.filter(item => item.id.startsWith('field:scenario')).map(item => item.text).join('\n\n')
  try {
    const answer = await ctx.run(worldJob(ctx.text, card, roster, scenario, opening))
    return { description: answer.description.trim(), tags: [...new Set(answer.tags.map(tag => tag.trim()))], ...(answer.starting_time ?? '').trim() === '' ? {} : { startingTime: answer.starting_time.trim() } }
  } catch (error) {
    const fallback = (scenario || cleanText(card.description, card.name)).slice(0, MAX_DESCRIPTION).trim()
    return { description: fallback, tags: card.tags.filter(tag => tag.trim() !== '' && tag.length <= MAX_TAG).slice(0, MAX_TAGS), note: `the description of the world was taken from the card as it is: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function hasEntities(world: string): Promise<boolean> {
  for (const { directory } of FOLDERS) {
    try {
      if ((await readdir(join(world, directory))).some(name => !name.startsWith('.'))) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return false
}

async function writeAtomically(file: string, text: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(temporary, text)
  await rename(temporary, file)
}

export interface FinishInput {
  /** The folder of the world the card is imported into. */
  directory: string
  card: NormalizedCard
  choices: ImportChoices
  roster: Roster
  items: readonly SourceItem[]
  classified: Classified
  extracted: Extracted
  picture?: Buffer
  /** What went wrong earlier in the import, in words. */
  notes: string[]
}

/** The world as it is after the import: every document written into it, or nothing changed and the problems found. */
export type FinishResult = { ok: true; report: ImportReport } | { ok: false; problems: string[] }

/**
 * Writes what was extracted into the world, all at once. The documents are first written to a staging folder and read back as the world will
 * read them when a session starts; only when every part of the world is valid are they moved in. The world's own file gets its description, tags, opening and cover.
 */
export async function finishImport(ctx: ImportContext, input: FinishInput): Promise<FinishResult> {
  const { directory, card, choices, roster, items, classified, extracted } = input
  if (await hasEntities(directory)) return { ok: false, problems: ['the world already has characters, places, factions, things or lore: an import only fills an empty world'] }
  const playing = extracted.characters.find(document => document['role'] === 'playable')
  const playerName = playing === undefined ? undefined : String(playing['name'])
  for (const key of ['characters', 'locations', 'factions', 'items', 'lore'] as const) replacePlayer(extracted[key], playerName)
  const notes = [...input.notes, ...extracted.notes, ...breakParentCircles(extracted.locations)]
  const stage = join(directory, IMPORT_FOLDER, STAGE)
  await rm(stage, { recursive: true, force: true })
  try {
    for (const { key, directory: folder, file } of FOLDERS) {
      for (const document of extracted[key]) await writeAtomically(join(stage, folder, String(document['id']), file), `${JSON.stringify(document, null, 2)}\n`)
    }
    try {
      await loadValidatedWorld({ directory: stage, summary: { name: choices.name } as never })
    } catch (error) {
      if (error instanceof InvalidWorldError) return { ok: false, problems: error.problems.map(problem => `${problem.path.replace(stage, '')}: ${problem.message}`.replace(/^: /, '')).concat(error.problems.length === 0 ? [error.message] : []) }
      throw error
    }
    for (const { directory: folder } of FOLDERS) {
      const from = join(stage, folder)
      if (await stat(from).then(() => true, () => false)) await rename(from, join(directory, folder))
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }

  const player = extracted.characters.find(document => document['role'] === 'playable')
  const opening = openingText(card, choices.opening)
  const described = await describeWorld(ctx, card, roster, items, opening ?? '')
  if (described.note !== undefined) notes.push(described.note)
  described.description = withPlayer(described.description, player === undefined ? undefined : String(player['name']))
  const file = join(directory, WORLD_FILE_NAME)
  const world = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as Document
  world['description'] = described.description
  if (described.startingTime !== undefined && world['starting_time'] === undefined) world['starting_time'] = described.startingTime
  world['metadata'] = { ...(typeof world['metadata'] === 'object' && world['metadata'] !== null ? world['metadata'] as Document : {}), tags: described.tags }
  if (opening !== undefined) world['opening_message'] = openingMessage(opening, card.name, player === undefined ? undefined : String(player['name']))
  if (card.creator.trim() !== '' && world['author'] === undefined) world['author'] = { name: card.creator.trim() }
  let cover = false
  if (input.picture !== undefined) {
    await writeAtomically(join(directory, 'media', 'files', 'cover.png'), input.picture)
    await writeAtomically(join(directory, 'media', 'manifest.jsonl'), `${JSON.stringify({ id: 'cover', file: 'media/files/cover.png' })}\n`)
    world['cover_media_id'] = 'cover'
    cover = true
  }
  await writeAtomically(file, `${JSON.stringify(world, null, 2)}\n`)

  const taken = (role: 'instruction' | 'template' | 'irrelevant'): number => items.filter(item => { const classification = classified[item.id]; return classification !== undefined && isLeftOut(classification) && classification.roles[0] === role }).length
  const report: ImportReport = {
    counts: { characters: extracted.characters.length, places: extracted.locations.length, factions: extracted.factions.length, things: extracted.items.length, lore: extracted.lore.length },
    hasPlayableCharacter: player !== undefined,
    opening: opening === undefined ? 'none' : 'imported',
    cover,
    leftOut: { instructions: taken('instruction'), templates: taken('template'), irrelevant: taken('irrelevant'), scripts: card.ignored.scripts },
    notes,
  }
  await writeAtomically(join(directory, IMPORT_FOLDER, 'report.json'), JSON.stringify(report, null, 2))
  return { ok: true, report }
}

export { PICTURE_FILE }
