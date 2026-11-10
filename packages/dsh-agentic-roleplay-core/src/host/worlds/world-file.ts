import { isTimeZone, parseInstant } from '@dsh-agentic-roleplay/state'
import type { VariableValue } from 'dsh-roleplay-model'
import { readVariableValues } from '../variables/values.ts'
import type { WorldAuthor } from '../../shared/worlds.ts'
import { readIdentifier } from '../identifiers.ts'
import { isLorebookName } from '../lorebooks/lorebooks.ts'
import { isPresetName } from '../presets/presets.ts'
import { parseSwitchboard, type Switchboard } from '../../shared/settings.ts'
import { MAX_QUESTION_OPTIONS, MAX_QUESTION_TEXT, MAX_START_QUESTIONS, START_PLOT_STATUSES, type StartEffect, type StartQuestion } from '../../shared/start-questions.ts'
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
  /** Questions asked before a story starts; each answer may change only what a `StartEffect` allows. */
  startQuestions?: StartQuestion[]
  /** What is not allowed in this world, as short rules in the author's own words ("There is no magic"). */
  rules?: string[]
  /** The optional tools the world's agents have switched on or off, by kind of agent; names this version does not know are kept. */
  tools?: Switchboard
  /** Whether stories of this world go on while their player is away (characters keep to their days at the real time and may write); absent means not. */
  autonomy?: boolean
  /** Provider voice id used for narration when a session starts. */
  narrationVoice?: string
  /** How the world's stories ask their models; a preset's own values and the person's choices at the start come before it. */
  sampling?: StorySampling
  /** The name of the preset in the person's library this world suggests; sessions use it when none is chosen. */
  preset?: string
  /** The lorebooks of the person's library this world suggests; stories are started with them when none are chosen. */
  lorebooks?: string[]
}

export interface AlternateOpening {
  title: string
  text: string
  /** The id of the playable character this opening is for; any character may take it when this is absent. */
  character?: string
}

import { parseSampling, type StorySampling } from '../../shared/sampling.ts'
import { MAX_ALTERNATE_OPENINGS, MAX_OPENING_CHARS, MAX_WORLD_VERSION } from '../../shared/world-info.ts'
export { MAX_ALTERNATE_OPENINGS, MAX_OPENING_CHARS }

/** `alternate_openings` is a list of `{ title, text, character? }`: other first messages the player may start with, each for any character or for one playable character. */
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
    const character = entry.string('character')?.trim()
    openings.push({ title: entry.string('title')?.trim() || text.slice(0, 40), text, ...(character === undefined || character === '' ? {} : { character }) })
  }
  return openings.length === 0 ? undefined : openings
}

/** The most rules a world may state, and the longest one: they are told to the game master every turn. */
export const MAX_RULES = 30
export const MAX_RULE_LENGTH = 300


const EFFECT_KEYS = ['rules', 'opening', 'starting_time', 'clock_mode', 'tools', 'plots']

/** One answer's `effect`: only the allow-listed keys, each checked; an unknown key is refused so an answer can never reach a setting it was not meant to. */
function readEffect(entry: Reader, openings: number): StartEffect {
  const raw = entry.raw('effect')
  const effect: StartEffect = {}
  if (raw === undefined || raw === null) return effect
  if (typeof raw !== 'object' || Array.isArray(raw)) { entry.fail('effect', 'must be an object'); return effect }
  const body = raw as Record<string, unknown>
  for (const key of Object.keys(body)) if (!EFFECT_KEYS.includes(key)) entry.fail(`effect.${key}`, `is not something an answer can change (${EFFECT_KEYS.join(', ')})`)
  if (body['rules'] !== undefined) {
    const rules = Array.isArray(body['rules']) && body['rules'].every(rule => typeof rule === 'string') ? (body['rules'] as string[]).map(rule => rule.trim()).filter(rule => rule !== '') : undefined
    if (rules === undefined) entry.fail('effect.rules', 'must be a list of rules')
    else if (rules.some(rule => rule.length > MAX_RULE_LENGTH)) entry.fail('effect.rules', `has a rule longer than ${MAX_RULE_LENGTH} characters`)
    else if (rules.length > 0) effect.rules = rules
  }
  if (body['opening'] !== undefined) {
    if (typeof body['opening'] !== 'number' || !Number.isInteger(body['opening']) || body['opening'] < 0 || body['opening'] >= openings) entry.fail('effect.opening', `must be the position of one of the ${openings} alternate openings`)
    else effect.opening = body['opening']
  }
  if (body['starting_time'] !== undefined) {
    if (typeof body['starting_time'] !== 'string' || body['starting_time'].trim() === '') entry.fail('effect.starting_time', 'must be a local time like 1912-04-14T23:40:00')
    else effect.startingTime = body['starting_time'].trim()
  }
  if (body['clock_mode'] !== undefined) {
    if (body['clock_mode'] !== 'simulated' && body['clock_mode'] !== 'real') entry.fail('effect.clock_mode', 'must be "simulated" or "real"')
    else effect.clockMode = body['clock_mode']
  }
  if (body['tools'] !== undefined) {
    const board = parseSwitchboard(body['tools'], 'tools')
    if (typeof board === 'string') entry.fail('effect.tools', board.replace(/^"tools"\s*/, ''))
    else if (Object.keys(board).length > 0) effect.tools = board
  }
  if (body['plots'] !== undefined) {
    const plots = body['plots']
    if (typeof plots !== 'object' || plots === null || Array.isArray(plots)) entry.fail('effect.plots', 'must map plot ids to "dormant" or "available"')
    else {
      const kept: NonNullable<StartEffect['plots']> = {}
      for (const [id, status] of Object.entries(plots)) {
        if (status !== 'dormant' && status !== 'available') entry.fail(`effect.plots.${id}`, `must be one of ${START_PLOT_STATUSES.join(', ')}`)
        else kept[id] = status
      }
      if (Object.keys(kept).length > 0) effect.plots = kept
    }
  }
  return effect
}

/** `start_questions`: `{ id, text, options: [{ id, label, description?, effect }] }`, asked in the start dialog. */
function readStartQuestions(reader: Reader, openings: number): StartQuestion[] | undefined {
  const value = reader.raw('start_questions')
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) { reader.fail('start_questions', 'must be a list'); return undefined }
  if (value.length > MAX_START_QUESTIONS) reader.fail('start_questions', `has more than ${MAX_START_QUESTIONS} questions`)
  const questions: StartQuestion[] = []
  const seen = new Set<string>()
  for (const entry of reader.objects('start_questions')) {
    const id = entry.string('id', { required: true })?.trim()
    const text = entry.string('text', { required: true })?.trim()
    if (id === undefined || text === undefined || id === '' || text === '') continue
    if (seen.has(id)) entry.fail('id', `repeats the question "${id}"`)
    seen.add(id)
    if (text.length > MAX_QUESTION_TEXT) entry.fail('text', `is longer than ${MAX_QUESTION_TEXT} characters`)
    const raw = entry.raw('options')
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_QUESTION_OPTIONS) { entry.fail('options', `must list 2 to ${MAX_QUESTION_OPTIONS} answers`); continue }
    const options: StartQuestion['options'] = []
    const ids = new Set<string>()
    for (const option of entry.objects('options')) {
      const optionId = option.string('id', { required: true })?.trim()
      const label = option.string('label', { required: true })?.trim()
      if (optionId === undefined || label === undefined || optionId === '' || label === '') continue
      if (ids.has(optionId)) option.fail('id', `repeats the answer "${optionId}"`)
      ids.add(optionId)
      if (label.length > MAX_QUESTION_TEXT) option.fail('label', `is longer than ${MAX_QUESTION_TEXT} characters`)
      const description = option.string('description')?.trim()
      options.push({ id: optionId, label, ...(description === undefined || description === '' ? {} : { description }), effect: readEffect(option, openings) })
    }
    questions.push({ id, text, options })
  }
  return questions.length === 0 ? undefined : questions
}

/** `tools`: switches by kind of agent and tool name; a world carried from a version with other tools still loads. */
function readTools(reader: Reader): Switchboard | undefined {
  const value = reader.raw('tools')
  if (value === undefined) return undefined
  const board = parseSwitchboard(value, 'tools')
  if (typeof board === 'string') { reader.fail('tools', board.replace(/^"tools"\s*/, '')); return undefined }
  return Object.keys(board).length === 0 ? undefined : board
}

/** `sampling` is an object of the controls a story's requests may carry (see `StorySampling`). */
function readSampling(reader: Reader): StorySampling | undefined {
  const problems: string[] = []
  const sampling = parseSampling(reader.raw('sampling'), 'sampling', problems)
  for (const problem of problems) reader.fail('sampling', problem.replace(/^sampling\.?/, ''))
  return Object.keys(sampling).length === 0 ? undefined : sampling
}

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
  const tools = readTools(reader)
  const autonomyValue = reader.raw('autonomy')
  if (autonomyValue !== undefined && autonomyValue !== null && typeof autonomyValue !== 'boolean') reader.fail('autonomy', 'must be true or false')
  const autonomy = autonomyValue === true ? true : undefined
  const alternateOpenings = readAlternateOpenings(reader)
  const startQuestions = readStartQuestions(reader, alternateOpenings?.length ?? 0)
  const narrationVoice = reader.string('narration_voice')?.trim() || undefined
  const sampling = readSampling(reader)
  const preset = reader.string('preset')?.trim() || undefined
  if (preset !== undefined && !isPresetName(preset)) reader.fail('preset', 'must be the name of a preset: letters, digits, "-" and "_"')
  const lorebooks = reader.strings('lorebooks').map(entry => entry.trim()).filter(entry => entry !== '')
  for (const [index, entry] of lorebooks.entries()) if (!isLorebookName(entry)) reader.fail(`lorebooks[${index}]`, 'must be the name of a lorebook: letters, digits, "-" and "_"')
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
      ...(tools === undefined ? {} : { tools }),
      ...(autonomy === undefined ? {} : { autonomy }),
      ...(alternateOpenings === undefined ? {} : { alternateOpenings }),
      ...(startQuestions === undefined ? {} : { startQuestions }),
      ...(narrationVoice === undefined ? {} : { narrationVoice }),
      ...(sampling === undefined ? {} : { sampling }),
      ...(preset === undefined ? {} : { preset }),
      ...(lorebooks.length === 0 ? {} : { lorebooks: [...new Set(lorebooks)] }),
    },
  }
}
