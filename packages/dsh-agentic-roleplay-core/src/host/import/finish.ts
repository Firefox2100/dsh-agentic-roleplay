
import type { Translate } from 'dsh-roleplay-model'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportChoices, NormalizedCard } from '../../shared/import-card.ts'
import { writeImageFileMetadata } from '../images/image-files.ts'
import { referenceImagePath } from '../images/storage.ts'
import { VARIABLES_FILE_NAME } from '../variables/load.ts'
import { COMMANDS_FILE_NAME } from '../commands/load.ts'
import { TRIGGERS_FILE_NAME } from '../triggers/load.ts'

import { MAX_ALTERNATE_OPENINGS, MAX_OPENING_CHARS } from '../worlds/world-file.ts'

import { cleanText, withPlayer, type SourceItem } from './items.ts'
import { pruneKnowledge, pruneLinks, pruneLoreSubjects, pruneMembers, pruneRelationships, type Extracted } from './extract.ts'
import { promptProblem, PROMPTS_FOLDER, shippedLanguages } from '../prompts/library.ts'
import { norm, type ChildJob, type ImportContext, type TextOf, trOf } from './run.ts'
import { IMPORT_FOLDER, PICTURE_FILE, openingText } from './store.ts'
import { isLeftOut, type Classified, type Roster } from './survey.ts'
import { atomicWrite } from '../atomic-write.ts'
import { updateWorldFile } from '../worlds/world-file-io.ts'
import { checkWorld, type WorldCheck } from '../worlds/world-check.ts'
import { ENTITY_FOLDERS } from '../worlds/entity-folders.ts'

type Document = Record<string, unknown>

const STAGE = 'stage'
const MAX_DESCRIPTION = 500
const MAX_TAGS = 8
const MAX_TAG = 30


/** What came of an import, for the person and for the chat that ran it. */
export interface ImportReport {
  counts: { characters: number; places: number; factions: number; things: number; lore: number }
  /** The prose prompts written into the world from the card's instructions. */
  prompts: string[]
  /** How many tracked variables the card's panels and meters became. */
  variables: number
  hasPlayableCharacter: boolean
  opening: 'imported' | 'none'
  /** How many of the card's other greetings the world offers as openings to choose from. */
  alternateOpenings: number
  cover: boolean
  /** Whether the card's picture became the portrait of the character it is of. */
  portrait: boolean
  /** What was read and not carried on, by what it was. */
  leftOut: { instructions: number; templates: number; irrelevant: number; scripts: number }
  /** The pictures the card pointed to: how many looked like pictures and how many were fetched into the world's image library. */
  pictures: { found: number; added: number }
  /** Things that could not be carried over, each with its reason. */
  notes: string[]
}

/** The card's other greetings, as the other openings a player may start with: the first message and the alternates that were not chosen. */
export function alternateOpenings(card: NormalizedCard, chosen: ImportChoices['opening'], player?: string): { title: string; text: string }[] {
  if (chosen.kind === 'none') return []
  const greetings = [{ title: 'First message', text: card.firstMessage, taken: chosen.kind === 'first' }, ...card.alternateGreetings.map((text, index) => ({ title: `Alternate ${index + 1}`, text, taken: chosen.kind === 'alternate' && chosen.index === index }))]
  return greetings.flatMap(({ title, text, taken }) => {
    const cleaned = taken || text.trim() === '' ? '' : openingMessage(text, card.name, player)
    return cleaned === '' || cleaned.length > MAX_OPENING_CHARS ? [] : [{ title, text: cleaned }]
  }).slice(0, MAX_ALTERNATE_OPENINGS)
}

/** The character the card's picture shows: the one that carries the card's name, or the only one there is. */
export function cardCharacter(characters: readonly Document[], cardName: string): Document | undefined {
  return characters.find(document => norm(String(document['name'])) === norm(cardName)) ?? (characters.length === 1 ? characters[0] : undefined)
}

/** Makes the card's picture the canonical reference portrait of its character, as an image the person brought. */
export async function writePortrait(directory: string, picture: Buffer, characters: readonly Document[], cardName: string): Promise<boolean> {
  const character = cardCharacter(characters, cardName)
  if (character === undefined) return false
  const id = String(character['id'])
  const file = referenceImagePath(directory, { kind: 'character', localId: id })
  await writeAtomically(file, picture)
  await writeImageFileMetadata(file, {
    schema: 'dsh-roleplay-image/v3', purpose: 'reference', origin: 'uploaded', reusable: false, createdAt: new Date().toISOString(), originalName: PICTURE_FILE,
    description: `${String(character['name'])}: the portrait that came with the character card.`, tags: [String(character['name'])],
    subjects: [{ kind: 'character', localId: id, name: String(character['name']) }],
  })
  return true
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

/**
 * Every character knows every place of the imported world and the ways between them, unless its own file already says what it knows: a card describes a
 * world its people live in, and without this the closed-world rules would forbid a walk to a famous street. Changes the documents in place.
 */
export function shareThePlaces(characters: Document[], locations: Document[]): void {
  const places = locations.map(location => String(location['id']))
  const ways: { from: string; to: string }[] = []
  for (const location of locations) {
    const from = String(location['id'])
    for (const exit of Array.isArray(location['exits']) ? location['exits'] as Document[] : []) {
      const to = String(exit['to'])
      ways.push({ from, to })
      if (exit['one_way'] !== true) ways.push({ from: to, to: from })
    }
  }
  for (const character of characters) {
    const knowledge = (typeof character['knowledge'] === 'object' && character['knowledge'] !== null ? character['knowledge'] : {}) as Document
    if (knowledge['locations'] !== undefined || knowledge['exits'] !== undefined) continue
    knowledge['locations'] = places
    knowledge['exits'] = ways.filter((way, index) => ways.findIndex(other => other.from === way.from && other.to === way.to) === index)
    character['knowledge'] = knowledge
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

function worldJob(text: TextOf, tr: Translate, card: NormalizedCard, roster: Roster, scenario: string, opening: string): ChildJob<WorldAnswer> {
  const names = (kind: string): string => roster.filter(entity => entity.kind === kind).slice(0, 15).map(entity => entity.name).join('; ')
  return {
    persona: text('import/world-summary'),
    maxTokens: 1500,
    prompt: [tr('Card: {name}', { name: card.name }), ...(card.tags.length === 0 ? [] : [tr('Card tags: {tags}', { tags: card.tags.join(', ') })]), `${tr('Characters:')} ${names('character') || tr('(none)')}`, `${tr('Places:')} ${names('place') || tr('(none)')}`,
      `${tr('Scenario:')}\n${scenario.slice(0, 1200) || tr('(none)')}`, `${tr('Opening:')}\n${opening.slice(0, 1200) || tr('(none)')}`, `${tr('Description:')}\n${cleanText(card.description, card.name).slice(0, 1200) || tr('(none)')}`, `${tr('Creator\'s notes:')}\n${cleanText(card.creatorNotes, card.name).slice(0, 600) || tr('(none)')}`].join('\n\n'),
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
  if (ctx.noModel === true) return { description: (scenario || cleanText(card.description, card.name)).slice(0, MAX_DESCRIPTION).trim(), tags: card.tags.filter(tag => tag.trim() !== '' && tag.length <= MAX_TAG).slice(0, MAX_TAGS) }
  try {
    const answer = await ctx.run(worldJob(ctx.text, trOf(ctx), card, roster, scenario, opening))
    return { description: answer.description.trim(), tags: [...new Set(answer.tags.map(tag => tag.trim()))], ...(answer.starting_time ?? '').trim() === '' ? {} : { startingTime: answer.starting_time.trim() } }
  } catch (error) {
    const fallback = (scenario || cleanText(card.description, card.name)).slice(0, MAX_DESCRIPTION).trim()
    return { description: fallback, tags: card.tags.filter(tag => tag.trim() !== '' && tag.length <= MAX_TAG).slice(0, MAX_TAGS), note: `the description of the world was taken from the card as it is: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function hasEntities(world: string): Promise<boolean> {
  for (const { directory } of ENTITY_FOLDERS) {
    try {
      if ((await readdir(join(world, directory))).some(name => !name.startsWith('.'))) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return false
}

const writeAtomically = (file: string, text: string | Buffer): Promise<void> => atomicWrite(file, text, { createDirectory: true })

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
  pictures?: { found: number; added: number }
  /** What went wrong earlier in the import, in words. */
  notes: string[]
}

/** The world as it is after the import: every document written into it, or nothing changed and the problems found. */
export type FinishResult = { ok: true; report: ImportReport; /** Present when the world was written but would not start yet: what is wrong with it. */ draft?: WorldCheck } | { ok: false; problems: string[] }

/**
 * Writes what was extracted into the world, all at once. The documents are first written to a staging folder and read back as the world will
 * read them when a session starts; only when every part of the world is valid are they moved in. The world's own file gets its description, tags, opening and cover.
 */
export async function finishImport(ctx: ImportContext, input: FinishInput): Promise<FinishResult> {
  const { directory, card, choices, roster, items, classified, extracted } = input
  if (await hasEntities(directory)) return { ok: false, problems: ['the world already has characters, places, factions, things or lore: an import only fills an empty world'] }
  const playing = extracted.characters.find(document => document['role'] === 'playable')
  const playerName = playing === undefined ? undefined : String(playing['name'])
  for (const key of ['characters', 'locations', 'factions', 'items', 'lore', 'commands', 'triggers', 'variables'] as const) replacePlayer(extracted[key], playerName)
  const notes = [...input.notes, ...extracted.notes, ...breakParentCircles(extracted.locations)]
  shareThePlaces(extracted.characters, extracted.locations)
  const stage = join(directory, IMPORT_FOLDER, STAGE)
  await rm(stage, { recursive: true, force: true })
  const mend = (): void => { const view = { ...extracted, notes }; pruneLoreSubjects(view); pruneMembers(view); pruneLinks(view); pruneKnowledge(view); pruneRelationships(view) }
  mend()
  try {
    if (extracted.variables.length > 0) await writeAtomically(join(stage, VARIABLES_FILE_NAME), `${JSON.stringify(extracted.variables, null, 2)}\n`)
    if (extracted.commands.length > 0) await writeAtomically(join(stage, COMMANDS_FILE_NAME), `${JSON.stringify({ commands: extracted.commands }, null, 2)}\n`)
    if (extracted.triggers.length > 0) await writeAtomically(join(stage, TRIGGERS_FILE_NAME), `${JSON.stringify(extracted.triggers, null, 2)}\n`)
    for (const { key, directory: folder, file } of ENTITY_FOLDERS) {
      for (const document of extracted[key]) await writeAtomically(join(stage, folder, String(document['id']), file), `${JSON.stringify(document, null, 2)}\n`)
    }
    for (const { id, text } of extracted.prompts) {
      const problem = promptProblem('en', id, text)
      if (problem !== undefined) return { ok: false, problems: [`prompt ${id}: ${problem}`] }
    }
    // what the mends could not settle is not a reason to throw the extraction away: the world is written as a draft and repaired with the card at hand
    if (extracted.variables.length > 0) await rename(join(stage, VARIABLES_FILE_NAME), join(directory, VARIABLES_FILE_NAME))
    if (extracted.commands.length > 0) await rename(join(stage, COMMANDS_FILE_NAME), join(directory, COMMANDS_FILE_NAME))
    if (extracted.triggers.length > 0) await rename(join(stage, TRIGGERS_FILE_NAME), join(directory, TRIGGERS_FILE_NAME))
    for (const { directory: folder } of ENTITY_FOLDERS) {
      const from = join(stage, folder)
      if (await stat(from).then(() => true, () => false)) await rename(from, join(directory, folder))
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  const check = await checkWorld({ directory, summary: { name: choices.name } as never })
  if (!check.ok) notes.push(`the world was written as a draft: it would not start yet (${check.problems.length + check.more} problem(s) in ${check.summary ?? 'the world'})`)

  const player = extracted.characters.find(document => document['role'] === 'playable')
  for (const { id, text } of extracted.prompts) {
    for (const language of shippedLanguages()) await writeAtomically(join(directory, PROMPTS_FOLDER, language, `${id}.md`), `${withPlayer(text, player === undefined ? undefined : String(player['name']))}\n`)
  }
  const opening = openingText(card, choices.opening)
  const described = await describeWorld(ctx, card, roster, items, opening ?? '')
  if (described.note !== undefined) notes.push(described.note)
  described.description = withPlayer(described.description, player === undefined ? undefined : String(player['name']))
  let cover = false
  if (input.picture !== undefined) {
    await writeAtomically(join(directory, 'media', 'files', 'cover.png'), input.picture)
    await writeAtomically(join(directory, 'media', 'manifest.jsonl'), `${JSON.stringify({ id: 'cover', file: 'media/files/cover.png' })}\n`)
    cover = true
  }
  const alternates = alternateOpenings(card, choices.opening, player === undefined ? undefined : String(player['name']))
  await updateWorldFile(directory, (world) => {
    world['description'] = described.description
    if (described.startingTime !== undefined && world['starting_time'] === undefined) world['starting_time'] = described.startingTime
    world['metadata'] = { ...(typeof world['metadata'] === 'object' && world['metadata'] !== null ? world['metadata'] as Document : {}), tags: described.tags }
    if (opening !== undefined) world['opening_message'] = openingMessage(opening, card.name, player === undefined ? undefined : String(player['name']))
    if (alternates.length > 0) world['alternate_openings'] = alternates
    if (card.creator.trim() !== '' && world['author'] === undefined) world['author'] = { name: card.creator.trim() }
    if (cover) world['cover_media_id'] = 'cover'
  })
  let portrait = false
  if (input.picture !== undefined) {
    try { portrait = await writePortrait(directory, input.picture, extracted.characters, card.name) } catch (error) { notes.push(`the card's picture could not be used as a portrait: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const taken = (role: 'instruction' | 'template' | 'irrelevant'): number => items.filter(item => { const classification = classified[item.id]; return classification !== undefined && isLeftOut(classification) && classification.roles[0] === role }).length
  const report: ImportReport = {
    prompts: extracted.prompts.map(entry => entry.id),
    variables: extracted.variables.length,
    counts: { characters: extracted.characters.length, places: extracted.locations.length, factions: extracted.factions.length, things: extracted.items.length, lore: extracted.lore.length },
    hasPlayableCharacter: player !== undefined,
    opening: opening === undefined ? 'none' : 'imported',
    alternateOpenings: alternates.length,
    cover,
    portrait,
    leftOut: { instructions: taken('instruction'), templates: taken('template'), irrelevant: taken('irrelevant'), scripts: card.ignored.scripts },
    pictures: input.pictures ?? { found: 0, added: 0 },
    notes,
  }
  await writeAtomically(join(directory, IMPORT_FOLDER, 'report.json'), JSON.stringify(report, null, 2))
  return { ok: true, report, ...(check.ok ? {} : { draft: check }) }
}

export { PICTURE_FILE }
