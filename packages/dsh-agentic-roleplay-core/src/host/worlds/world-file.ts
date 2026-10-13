import { isTimeZone, parseInstant } from '@dsh-agentic-roleplay/state'
import type { VariableValue } from 'dsh-roleplay-model'
import { readVariableValues } from '../variables/values.ts'
import type { WorldAuthor } from '../../shared/worlds.ts'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const WORLD_FILE_NAME = 'world.json'

/**
 * The fields of `world.json` the roleplay UI reads. The file follows the
 * world-simulation-engine export format; everything else in it is ignored.
 */
export interface WorldFile {
  /** Stable identity of the world; absent in a file that has never been indexed. */
  id?: string
  name: string
  description: string
  /** From `metadata.tags`. */
  tags: string[]
  author?: WorldAuthor
  /** The author's own version label of the world (`version`), up to 40 characters. */
  version?: string
  /** Id of a row in `media/manifest.jsonl`. */
  coverMediaId?: string
  /** What the story opens with: shown as the first message of a new session, before the player says anything. */
  opening?: OpeningSegment[]
  /** When the story begins and the zone its time is read in; a session's story clock starts from them. */
  clock?: WorldClock
  /** What the world starts with of what it tracks, for the variables of the whole story. */
  variables?: Record<string, VariableValue>
  /** Other ways the story can begin, which the player may choose when starting a session; each is one narration. */
  alternateOpenings?: AlternateOpening[]
  /** What is not allowed in this world, as short rules in the author's own words ("There is no magic"). */
  rules?: string[]
  /** Provider voice id used for narration when a session starts. */
  narrationVoice?: string
}

export interface AlternateOpening {
  title: string
  text: string
}

import { MAX_ALTERNATE_OPENINGS, MAX_OPENING_CHARS, MAX_WORLD_VERSION } from '../../shared/world-info.ts'
export { MAX_ALTERNATE_OPENINGS, MAX_OPENING_CHARS }

/** `alternate_openings` is a list of `{ title, text }`: other first messages the player may start with. */
function readAlternateOpenings(reader: Reader): AlternateOpening[] | undefined {
  const value = reader.raw('alternate_openings')
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) { reader.fail('alternate_openings', 'must be a list'); return undefined }
  if (value.length > MAX_ALTERNATE_OPENINGS) reader.fail('alternate_openings', `has more than ${MAX_ALTERNATE_OPENINGS} openings`)
  const openings: AlternateOpening[] = []
  for (const entry of reader.objects('alternate_openings')) {
    const text = entry.string('text', { required: true })?.trim()
    if (text === undefined || text === '') continue
    if (text.length > MAX_OPENING_CHARS) entry.fail('text', `is longer than ${MAX_OPENING_CHARS} characters`)
    openings.push({ title: entry.string('title')?.trim() || text.slice(0, 40), text })
  }
  return openings.length === 0 ? undefined : openings
}

/** The most rules a world may state, and the longest one: they are told to the game master every turn. */
export const MAX_RULES = 30
export const MAX_RULE_LENGTH = 300

/** `rules` is one rule as text, or a list of them; blank ones are left out. */
function readRules(reader: Reader): string[] | undefined {
  const value = reader.raw('rules')
  if (value === undefined || value === null) return undefined
  const rules = typeof value === 'string' ? [value] : reader.strings('rules')
  const kept = rules.map(rule => rule.trim()).filter(rule => rule !== '')
  if (kept.length > MAX_RULES) reader.fail('rules', `has more than ${MAX_RULES} rules`)
  const long = kept.findIndex(rule => rule.length > MAX_RULE_LENGTH)
  if (long >= 0) reader.fail('rules', `rule ${long + 1} is longer than ${MAX_RULE_LENGTH} characters: keep rules short`)
  return kept.length === 0 ? undefined : kept
}

export interface WorldClock {
  /** The instant the story begins, in UTC milliseconds. */
  startingTime?: number
  /** An IANA time zone name. */
  timeZone?: string
}

/** One part of an opening: narration, or a line spoken by one of the world's characters (by the character's id). */
export type OpeningSegment =
  | { type: 'narration'; text: string }
  | { type: 'utterance'; character: string; text: string }

/** `opening_message` is plain text (one narration), or a list of parts in the order the player reads them. */
function readOpening(reader: Reader): OpeningSegment[] | undefined {
  const value = reader.raw('opening_message')
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() === '' ? undefined : [{ type: 'narration', text: value.trim() }]
  if (!Array.isArray(value)) {
    reader.fail('opening_message', 'must be text or a list of parts')
    return undefined
  }
  const parts: OpeningSegment[] = []
  for (const part of reader.objects('opening_message')) {
    const type = part.oneOf('type', ['narration', 'utterance'] as const, 'narration')
    const text = part.string('text', { required: true })?.trim()
    if (text === undefined || text === '') continue
    if (type === 'narration') {
      parts.push({ type, text })
      continue
    }
    const character = part.string('character', { required: true })
    if (character !== undefined) parts.push({ type, character, text })
  }
  return parts.length === 0 ? undefined : parts
}

/** `time_zone` (an IANA name) and `starting_time` (an ISO 8601 date and time, in `time_zone` unless it carries an offset). */
function readClock(reader: Reader): WorldClock | undefined {
  const timeZone = reader.string('time_zone')
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    reader.fail('time_zone', `"${timeZone}" is not a time zone: write it like Europe/London or UTC`)
    return undefined
  }
  const text = reader.string('starting_time')
  let startingTime: number | undefined
  if (text !== undefined) {
    try {
      startingTime = parseInstant(text, timeZone ?? 'UTC')
    } catch (error) {
      reader.fail('starting_time', error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
  return timeZone === undefined && startingTime === undefined ? undefined : { ...(startingTime === undefined ? {} : { startingTime }), ...(timeZone === undefined ? {} : { timeZone }) }
}

function readAuthor(reader: Reader | undefined): WorldAuthor | undefined {
  if (reader === undefined) return undefined
  const name = reader.string('name', { required: true })
  const url = reader.string('url')
  return name === undefined ? undefined : { name, ...(url === undefined ? {} : { url }) }
}

export function parseWorldFile(text: string): ParseResult<WorldFile> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }

  const id = readIdentifier(reader)
  const name = reader.string('name', { required: true })
  const description = reader.text('description')
  const tags = reader.object('metadata')?.strings('tags') ?? []
  const author = readAuthor(reader.object('author'))
  const rawVersion = reader.raw('version')
  if (rawVersion !== undefined && rawVersion !== null && typeof rawVersion !== 'string' && typeof rawVersion !== 'number') reader.fail('version', 'must be text or a number')
  const version = (typeof rawVersion === 'string' || typeof rawVersion === 'number' ? String(rawVersion).trim() : '') || undefined
  if (version !== undefined && version.length > MAX_WORLD_VERSION) reader.fail('version', `is longer than ${MAX_WORLD_VERSION} characters`)
  const coverMediaId = reader.string('cover_media_id')
  const opening = readOpening(reader)
  const clock = readClock(reader)
  const variables = readVariableValues(reader)
  const rules = readRules(reader)
  const alternateOpenings = readAlternateOpenings(reader)
  const narrationVoice = reader.string('narration_voice')?.trim() || undefined
  if (name === undefined || issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    value: {
      ...(id === undefined ? {} : { id }),
      name,
      description,
      tags,
      ...(author === undefined ? {} : { author }),
      ...(version === undefined ? {} : { version }),
      ...(coverMediaId === undefined ? {} : { coverMediaId }),
      ...(opening === undefined ? {} : { opening }),
      ...(clock === undefined ? {} : { clock }),
      ...(variables === undefined ? {} : { variables }),
      ...(rules === undefined ? {} : { rules }),
      ...(alternateOpenings === undefined ? {} : { alternateOpenings }),
      ...(narrationVoice === undefined ? {} : { narrationVoice }),
    },
  }
}
