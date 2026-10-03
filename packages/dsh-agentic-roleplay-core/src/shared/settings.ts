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
  }
  context: {
    /** The size of the conversation, in tokens, at which the oldest part is folded into the summaries. */
    limitTokens: number
    /** The share of the limit that stays verbatim when the conversation is folded. */
    retainRatio: number
    /** The size of the short-term summary, in tokens, before its oldest part moves into the long-term one. */
    shortTermTokens: number
    /** The size of the long-term summary, in tokens, before its oldest part is condensed further. */
    longTermTokens: number
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

/** A flat set of named values whose names are not known here. */
interface RecordSpec { kind: 'record'; fallback: EmbeddingOptions }
interface NumberSpec { kind: 'integer' | 'number'; min: number; max: number; fallback: number }
interface FlagSpec { kind: 'flag'; fallback: boolean }
type FieldSpec = NumberSpec | FlagSpec | RecordSpec
type Spec = { [key: string]: FieldSpec | Spec }

const integer = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'integer', min, max, fallback })
const ratio = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'number', min, max, fallback })
const flag = (fallback: boolean): FlagSpec => ({ kind: 'flag', fallback })
const record = (): RecordSpec => ({ kind: 'record', fallback: {} })

export const SETTINGS_SPEC = {
  maxRounds: integer(1, 10, 3),
  memory: { flaky: flag(true), recall: integer(1, 30, 12), lookup: flag(true), verify: flag(true), backlogRounds: integer(1, 100, 6) },
  context: {
    limitTokens: integer(4000, 1_000_000, 24_000),
    retainRatio: ratio(0.1, 0.9, 0.5),
    shortTermTokens: integer(200, 20_000, 1500),
    longTermTokens: integer(200, 40_000, 2500),
  },
  embedding: { options: record() },
} as const satisfies Spec

const isField = (spec: FieldSpec | Spec): spec is FieldSpec => 'kind' in spec && typeof spec['kind'] === 'string'

function defaultsOf(spec: Spec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([key, entry]) => [key, isField(entry) ? (entry.kind === 'record' ? { ...entry.fallback } : entry.fallback) : defaultsOf(entry)]))
}

export const DEFAULT_SETTINGS = defaultsOf(SETTINGS_SPEC) as unknown as ChatSettings

export type SettingsParse = { ok: true; value: ChatSettings } | { ok: false; problems: string[] }

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
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: parsed as unknown as ChatSettings }
}

/** The settings of a chat as the API gives them, with the bounds the form needs. */
export interface SettingsPayload {
  settings: ChatSettings
  bounds: typeof SETTINGS_SPEC
  /** How many recorded rounds are not yet written into the story's records; they are caught up with the next turn. */
  pendingRecords: number
}
