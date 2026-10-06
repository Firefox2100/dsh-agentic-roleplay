import { CLOCK_MODES, type ClockMode } from 'dsh-roleplay-model'
import { MAX_OWN_RULES } from './rules.ts'

/** What can be set for one chat. Stored as a file next to the chat's database: it is configuration, not story state. */
export interface ChatSettings {
  /** The most rounds of characters acting that the game master may run for one player message. */
  maxRounds: number
  memory: {
    /** Whether characters remember imperfectly: details fade with age and unimportance, and they may misperceive. Off for exact recall. */
    flaky: boolean
    /** The most things one character is reminded of when it acts. */
    recall: number
    /** Whether a character can ask itself about more of what it remembers while it decides what to do. It makes a character's turn a little longer. */
    lookup: boolean
    /** Whether the record keeper must read back what it wrote and compare it with the round before it finishes. It costs a couple more model calls in the background of the narration; turn it off where speed matters more. */
    verify: boolean
    /** How many recorded rounds may wait for the memory keeper before it is run regardless of the game master. The game master normally decides when what happened is worth recording. */
    backlogRounds: number
    /** How many times the number of memories a character is reminded of are retrieved before a reranker (when there is one) and the memory's own weight choose the best. */
    overRetrieve: number
  }
  context: {
    /** The size of the conversation, in tokens, at which the oldest part is folded into the summaries; 0 takes a share of the model's context window (`limitRatio`). */
    limitTokens: number
    /** With no limit given, the share of the selected model's context window at which the conversation is folded. */
    limitRatio: number
    /** The share of the limit that stays verbatim when the conversation is folded. */
    retainRatio: number
    /** The size of the short-term summary, in tokens, before its oldest part moves into the long-term one. */
    shortTermTokens: number
    /** The size of the long-term summary, in tokens, before its oldest part is condensed further. */
    longTermTokens: number
  }
  authoring: {
    /** Whether the game master may have new characters and places made up when the story genuinely needs them. Off for a closed world. */
    enabled: boolean
    /** The most new characters and places that may be made up in one turn. */
    perTurn: number
    /** How many made-up characters and places may wait to be fitted into the world (connected to the rest, given relationships) before that is done at the end of the turn. */
    consolidateAfter: number
  }
  clock: {
    /** `simulated`: the story's time moves only with the story, by as much as the game master says, and it can be skipped ahead. `real`: the story's time is the wall clock. */
    mode: ClockMode
    /** The time zone the story's time is read in (an IANA name such as `Europe/London`); empty is UTC. */
    timeZone: string
    /** In simulated time, how long a round takes when the game master does not say. */
    roundSeconds: number
    /** The longest the game master may skip ahead in one go. */
    maxSkipDays: number
  }
  offstage: {
    /** The most characters, away from the player's character, that may be asked what they do about something that fell due (a commitment whose time came, a deadline that passed) after a turn. 0 turns it off. */
    perTurn: number
  }
  reasoning: {
    /** How hard the child agents think, as a level the model offers (for example `off` or `low`); empty is the game master's own level. */
    children: string
  }
  triggers: {
    /** Whether the world acts by itself when what its triggers wait for comes true. */
    enabled: boolean
    /** The most triggers that fire in one look (after a round, or at the start of a turn); the rest wait for the next. */
    maxFires: number
    /** How many turns a beat the game master does not weave in stays pending. */
    beatTurns: number
    /** How many turns a cue a character did not get to act on stays pending. */
    cueTurns: number
  }
  rewind: {
    /** How many of the turns most recently played keep a snapshot of the story's state, so that the story can be taken back to them; 0 keeps none and turns rewinding off. */
    keepSnapshots: number
  }
  rules: {
    /** What is not allowed in this story besides what the world itself rules out, in your own words, one rule per line ("No one can fly"). The game master holds the player's actions and out-of-character commands to the world's rules and these. */
    own: string
  }
  preview: {
    /** Whether the game master first shows the player a short opening of the scene, before the characters are asked, so that something is on screen while the rest of the turn is worked out. */
    enabled: boolean
  }
  suggestions: {
    /** How many things the player could do next are offered after each turn, to pick from and fill the input; 0 offers none. */
    count: number
  }
  images: {
    /** Whether scene illustrations are disabled, requested by the player, or generated after every delivered turn. */
    mode: 'off' | 'manual' | 'every-turn'
    /** Whether transient generation ignores, uses when available, or requires canonical reference images. */
    references: 'text-only' | 'prefer-reference' | 'require-reference'
  }
  embedding: {
    /**
     * What is set per request to the embedding provider, by the name the provider gives each option
     * (for instance the number of dimensions of the vectors). Which options exist is the provider's to
     * say; they are passed on as the options of every embedding call this chat makes.
     */
    options: EmbeddingOptions
  }
}

export type EmbeddingValue = number | string | boolean
export type EmbeddingOptions = Record<string, EmbeddingValue>

/** At most this many options, so that a settings file cannot grow without bound. */
export const MAX_EMBEDDING_OPTIONS = 20

/** One of a fixed set of words. */
interface ChoiceSpec { kind: 'choice'; options: readonly string[]; fallback: string }
/** Free text of at most `max` characters. */
interface TextSpec { kind: 'text'; max: number; fallback: string }
/** A flat set of named values whose names are not known here. */
interface RecordSpec { kind: 'record'; fallback: EmbeddingOptions }
interface NumberSpec { kind: 'integer' | 'number'; min: number; max: number; fallback: number }
interface FlagSpec { kind: 'flag'; fallback: boolean }
type FieldSpec = NumberSpec | FlagSpec | RecordSpec | ChoiceSpec | TextSpec
type Spec = { [key: string]: FieldSpec | Spec }

const integer = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'integer', min, max, fallback })
const ratio = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'number', min, max, fallback })
const flag = (fallback: boolean): FlagSpec => ({ kind: 'flag', fallback })
const record = (): RecordSpec => ({ kind: 'record', fallback: {} })
const choice = (options: readonly string[], fallback: string): ChoiceSpec => ({ kind: 'choice', options, fallback })
const text = (max: number, fallback: string): TextSpec => ({ kind: 'text', max, fallback })

export const SETTINGS_SPEC = {
  maxRounds: integer(1, 10, 3),
  memory: { flaky: flag(true), recall: integer(1, 30, 12), lookup: flag(true), verify: flag(true), backlogRounds: integer(1, 100, 6), overRetrieve: integer(1, 10, 4) },
  context: {
    limitTokens: integer(0, 1_000_000, 0),
    limitRatio: ratio(0.1, 0.9, 0.6),
    retainRatio: ratio(0.1, 0.9, 0.5),
    shortTermTokens: integer(200, 20_000, 1500),
    longTermTokens: integer(200, 40_000, 2500),
  },
  authoring: { enabled: flag(true), perTurn: integer(1, 5, 2), consolidateAfter: integer(1, 20, 3) },
  clock: { mode: choice(CLOCK_MODES, 'simulated'), timeZone: text(64, ''), roundSeconds: integer(0, 3600, 30), maxSkipDays: integer(1, 3650, 30) },
  offstage: { perTurn: integer(0, 5, 2) },
  reasoning: { children: text(40, '') },
  triggers: { enabled: flag(true), maxFires: integer(1, 10, 3), beatTurns: integer(1, 20, 3), cueTurns: integer(1, 20, 2) },
  rewind: { keepSnapshots: integer(0, 500, 30) },
  rules: { own: text(MAX_OWN_RULES, '') },
  preview: { enabled: flag(true) },
  suggestions: { count: integer(0, 5, 3) },
  images: { mode: choice(['off', 'manual', 'every-turn'], 'manual'), references: choice(['text-only', 'prefer-reference', 'require-reference'], 'prefer-reference') },
  embedding: { options: record() },
} as const satisfies Spec

const isField = (spec: FieldSpec | Spec): spec is FieldSpec => 'kind' in spec && typeof spec['kind'] === 'string'

function defaultsOf(spec: Spec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([key, entry]) => [key, isField(entry) ? (entry.kind === 'record' ? { ...entry.fallback } : entry.fallback) : defaultsOf(entry)]))
}

export const DEFAULT_SETTINGS = defaultsOf(SETTINGS_SPEC) as unknown as ChatSettings

export type SettingsParse = { ok: true; value: ChatSettings } | { ok: false; problems: string[] }

/** Whether a name is a time zone the runtime knows. */
export function isTimeZone(zone: string): boolean {
  if (zone.trim() === '' || zone !== zone.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/** The options, or what is wrong with them. */
function parseOptions(value: unknown, name: string): EmbeddingOptions | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `"${name}" must be an object`
  const entries = Object.entries(value)
  if (entries.length > MAX_EMBEDDING_OPTIONS) return `"${name}" may have at most ${MAX_EMBEDDING_OPTIONS} options`
  const bad = entries.find(([key, entry]) => !OPTION_NAME.test(key) || !(typeof entry === 'boolean' || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))))
  if (bad !== undefined) return `"${name}.${bad[0]}" must be a number, text or true/false, under a name of letters, digits and underscores`
  return Object.fromEntries(entries) as EmbeddingOptions
}

function describe(spec: NumberSpec): string {
  return spec.kind === 'integer' ? `a whole number from ${spec.min} to ${spec.max}` : `a number from ${spec.min} to ${spec.max}`
}

function parseLevel(spec: Spec, input: unknown, path: string, problems: string[]): Record<string, unknown> {
  const label = path === '' ? 'the settings' : `"${path}"`
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    problems.push(`${label} must be an object`)
    return {}
  }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) if (!(key in spec)) problems.push(`"${path === '' ? key : `${path}.${key}`}" is not a setting`)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(spec)) {
    const name = path === '' ? key : `${path}.${key}`
    const given = key in record ? record[key] : undefined
    if (!isField(entry)) {
      result[key] = parseLevel(entry, given === undefined ? {} : given, name, problems)
    } else if (given === undefined) {
      result[key] = entry.kind === 'record' ? { ...entry.fallback } : entry.fallback
    } else if (entry.kind === 'record') {
      const options = parseOptions(given, name)
      if (typeof options === 'string') problems.push(options)
      else result[key] = options
    } else if (entry.kind === 'flag') {
      if (typeof given === 'boolean') result[key] = given
      else problems.push(`"${name}" must be true or false`)
    } else if (entry.kind === 'choice') {
      if (typeof given === 'string' && entry.options.includes(given)) result[key] = given
      else problems.push(`"${name}" must be one of: ${entry.options.join(', ')}`)
    } else if (entry.kind === 'text') {
      if (typeof given === 'string' && given.length <= entry.max) result[key] = given
      else problems.push(`"${name}" must be text of at most ${entry.max} characters`)
    } else if (typeof given === 'number' && Number.isFinite(given) && (entry.kind === 'number' || Number.isInteger(given)) && given >= entry.min && given <= entry.max) {
      result[key] = given
    } else {
      problems.push(`"${name}" must be ${describe(entry)}`)
    }
  }
  return result
}

/** Checks a settings value; fields left out take their default, anything unknown is refused. */
export function parseSettings(value: unknown): SettingsParse {
  const problems: string[] = []
  const parsed = parseLevel(SETTINGS_SPEC, value, '', problems)
  const zone = (parsed['clock'] as { timeZone?: unknown } | undefined)?.timeZone
  if (typeof zone === 'string' && zone !== '' && !isTimeZone(zone)) problems.push(`"clock.timeZone" is not a time zone this system knows: write it like Europe/London or UTC`)
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: parsed as unknown as ChatSettings }
}

/** The settings of a chat as the API gives them, with the bounds the form needs. */
export interface SettingsPayload {
  settings: ChatSettings
  bounds: typeof SETTINGS_SPEC
  /** How many recorded rounds are not yet written into the story's records; they are caught up with the next turn. */
  pendingRecords: number
  /** How many made-up characters, places and things are waiting to be fitted into the world. */
  pendingConsolidation: number
  /** The mode the story's clock is in now; time that is simulated cannot be made to follow the real clock again. */
  clockMode?: ClockMode
}
