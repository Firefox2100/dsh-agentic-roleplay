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
}

interface NumberSpec { kind: 'integer' | 'number'; min: number; max: number; fallback: number }
interface FlagSpec { kind: 'flag'; fallback: boolean }
type FieldSpec = NumberSpec | FlagSpec
type Spec = { [key: string]: FieldSpec | Spec }

const integer = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'integer', min, max, fallback })
const ratio = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'number', min, max, fallback })
const flag = (fallback: boolean): FlagSpec => ({ kind: 'flag', fallback })

export const SETTINGS_SPEC = {
  maxRounds: integer(1, 10, 3),
  memory: { flaky: flag(true), recall: integer(1, 30, 12), lookup: flag(true), verify: flag(true) },
  context: {
    limitTokens: integer(4000, 1_000_000, 24_000),
    retainRatio: ratio(0.1, 0.9, 0.5),
    shortTermTokens: integer(200, 20_000, 1500),
    longTermTokens: integer(200, 40_000, 2500),
  },
} as const satisfies Spec

const isField = (spec: FieldSpec | Spec): spec is FieldSpec => 'kind' in spec && typeof spec['kind'] === 'string'

function defaultsOf(spec: Spec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([key, entry]) => [key, isField(entry) ? entry.fallback : defaultsOf(entry)]))
}

export const DEFAULT_SETTINGS = defaultsOf(SETTINGS_SPEC) as unknown as ChatSettings

export type SettingsParse = { ok: true; value: ChatSettings } | { ok: false; problems: string[] }

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
      result[key] = entry.fallback
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
