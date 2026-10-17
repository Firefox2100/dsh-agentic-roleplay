import { CLOCK_MODES, type ClockMode } from 'dsh-roleplay-model'
import type { ActivityEntry } from './activity.ts'
import type { Intervention } from './interventions.ts'
import type { ReflectionStatus } from './reflection.ts'
import type { VectorStatus } from './vectors.ts'
import { MAX_OWN_RULES } from './rules.ts'

/** What can be set for one chat. Stored as a file next to the chat's database: it is configuration, not story state. */
export interface ChatSettings {
  /** The most rounds of characters acting that the game master may run for one player message. */
  maxRounds: number
  /** The most characters asked to act in one round. */
  maxCharacters: number
  memory: {
    /** Whether characters remember imperfectly: details fade with age and unimportance, and they may misperceive. Off for exact recall. */
    flaky: boolean
    /** The most things one character is reminded of when it acts. */
    recall: number
    /** Whether a character can ask itself about more of what it remembers while it decides what to do. It makes a character's turn a little longer. */
    lookup: boolean
    /** The most times a character may look into its memory while it decides, when it can at all; it is then told to answer. A character that keeps looking costs minutes. */
    lookupCalls: number
    /** Whether the record keeper must read back what it wrote and compare it with the round before it finishes. It costs a couple more model calls in the background of the narration; turn it off where speed matters more. */
    verify: boolean
    /** How many recorded rounds may wait for the memory keeper before it is run regardless of the game master. The game master normally decides when what happened is worth recording. */
    backlogRounds: number
    /** How many times the number of memories a character is reminded of are retrieved before a reranker (when there is one) and the memory's own weight choose the best. */
    overRetrieve: number
    associate: number
    /** How much a memory that repeats one already chosen counts against it, from 0 (none) to 1: maximal marginal relevance over the pool. */
    diversity: number
    /** How long what a character took in lasts once a belief rests on it, as a share of how long it would: below 1 it fades sooner and is not told again together with that belief. 1 changes nothing. */
    foldedFade: number
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
    /** The most things (a barricade, a found note, a tool) the game master may introduce itself in one turn, with no author asked. 0 turns it off. */
    thingsPerTurn: number
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
  diagnostics: {
    /** Whether each helper run keeps what the helper was told and did (its instructions, what it was asked, its tool calls and its result), so that the chat settings can show why it said or wrote what it did. The latest 60 runs are kept. */
    keepRuns: boolean
  }
  offstage: {
    /** The most characters, away from the player's character, that may be asked what they do about something that fell due (a commitment whose time came, a deadline that passed) after a turn. 0 turns it off. */
    perTurn: number
    /** The most times one character is asked in that run: a character with several things due is asked about the first and the rest waits for the next turn. */
    perCharacter: number
    /** Whether the characters of one commitment decide one after another, each told who has already meant to come, so that they meet; off, each decides alone, all at once. */
    joint: boolean
    /** Whether those characters also say in a line what came of it, in the same request, for the note shown to the player (it costs no request of its own). */
    summary: boolean
  }
  sampling: {
    /** The temperature of the game master's own requests: it decides what happens and writes the narration. */
    master: number
    /** The temperature of the characters' requests: they write prose, so it is the highest. */
    characters: number
    /** The temperature of the helper that writes the suggested actions for the player. */
    suggestions: number
    /** The temperature of the helpers that make things up (the world author, the plot author). */
    authoring: number
    /** The temperature of the helpers that must be exact (the record keeper, the image author): lower is more faithful to the rounds. */
    records: number
    /** The most tokens one request of a helper may produce; a helper that rambles is cut off instead of waited for. */
    maxTokens: number
    /** The same for the helpers whose answer is short (the characters and the suggestion writer): a run that does not stop costs minutes, so it is cut off much sooner. */
    shortMaxTokens: number
    /** How many times the estimated size of an answer a helper may produce before it is cut off (the room for a model that says a little before it answers). */
    headroom: number
    /** Whether those helpers must answer with a tool call, which keeps them from writing prose instead of their result. */
    tools: 'auto' | 'required'
  }
  prompts: {
    /** The language of the instructions the models are given: a folder of `prompts` in the roleplay root (`en`, `zh`). A language without prompts of its own uses the English ones. */
    language: string
  }
  reasoning: {
    /** How hard the child agents think, as a level the model offers (for example `off` or `low`); empty is the game master's own level. Thinking makes helpers (records, checks) slow, so a model that offers an off level should use it; a level the model does not offer stalls the helper. */
    children: string
  }
  factions: {
    /** The most organisations that decide what they do after one player message; 0 turns it off. Each is one request, and only when its own time has come. */
    perTurn: number
    /** How many days of story time pass between one organisation's decisions. */
    everyDays: number
  }
  reflection: {
    /** Whether the story reflects on its own: characters sort what they have taken in into what they believe, now and then (see `everyTurns`, `onSceneChange`). A pass can always be started by hand. */
    auto: boolean
    /** Reflect after this many turns since the last reflection; 0 turns this trigger off. */
    everyTurns: number
    /** Also reflect when the scene changes: the player's character has gone somewhere else, or `sceneDays` of story time have passed. */
    onSceneChange: boolean
    /** The days of story time since the last reflection that count as a change of scene; 0 turns that off. */
    sceneDays: number
    /** The fewest turns between two automatic reflections, whatever the trigger. */
    minTurns: number
    /** The most characters one automatic reflection takes up; each is one request in the background. */
    perRun: number
    /** A character is taken up only when this many things it took in are waiting; a pass started by hand takes one. */
    minNew: number
  }
  models: {
    /** The model each kind of helper runs on, as `provider/model`; empty is the chat's own model. A smaller, faster model suits the helpers that do not write the story's prose. */
    characters: string
    /** The characters of the background tier, when they should run on a cheaper model than the others; empty is the same as `characters`. */
    background: string
    /** The record keeper. */
    records: string
    /** The writer of suggested actions. */
    suggestions: string
    /** The world author and the plot author. */
    authoring: string
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
    /** The most statements that triggers wait on ("the mayor has lost the town's trust") a model judges after one player message, in one request; 0 turns judging off, and such triggers never fire. */
    judgedPerTurn: number
  }
  interface: {
    /** The interface pack the story uses: empty is the first pack the story carries, `none` turns packs off, a name picks that pack of the story or of the roleplay root. */
    pack: string
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
    /** Whether a picture the story needs on its own (every-turn mode) is first looked for among the images the session already has. */
    reuse: boolean
    /** Whether a picture is rendered again larger from its first result, when the image service can (the hires fix). */
    highRes: boolean
    /** Whether images the person brings are described by a model that can read images, so that they can be found. */
    interpret: boolean
    /** The model that describes them, as `provider/model`; empty is the chat's own model, which must be able to read images. */
    interpreterModel: string
    /** A model that only writes captions for pictures, as `provider/model` (a captioning model cannot call tools); the chat's model turns its caption into the description. Empty: the model above does both. */
    captioner: string
  }
  dice: {
    /** Whether the player sees what was rolled: a collapsed card under the narration that can be opened, or nothing, to stay in the story. The dice are rolled either way. */
    visibility: 'hidden' | 'card'
  }
  /**
   * The optional tools each kind of agent may use, as switches by tool name: a tool named true is on, false is off, one not named is as it is by default.
   * Names this version does not know are kept and have no effect, so that settings carried from a version with other tools still load.
   */
  tools: Switchboard
  embedding: {
    /**
     * What is set per request to the embedding provider, by the name the provider gives each option
     * (for instance the number of dimensions of the vectors). Which options exist is the provider's to
     * say; they are passed on as the options of every embedding call this chat makes.
     */
    options: EmbeddingOptions
  }
}

/** Kinds of agent, each with a switch for each of its optional tools. */
export type Switchboard = Record<string, Record<string, boolean>>

/** At most this many kinds of agent and tools of one, so that a settings file cannot grow without bound. */
export const MAX_SWITCH_AGENTS = 20
export const MAX_SWITCHES = 300

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
/** Switches by kind of agent and tool name, whose names are not known here. */
interface SwitchSpec { kind: 'switchboard' }
interface NumberSpec { kind: 'integer' | 'number'; min: number; max: number; fallback: number }
interface FlagSpec { kind: 'flag'; fallback: boolean }
type FieldSpec = NumberSpec | FlagSpec | RecordSpec | ChoiceSpec | TextSpec | SwitchSpec
type Spec = { [key: string]: FieldSpec | Spec }

const integer = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'integer', min, max, fallback })
const ratio = (min: number, max: number, fallback: number): NumberSpec => ({ kind: 'number', min, max, fallback })
const flag = (fallback: boolean): FlagSpec => ({ kind: 'flag', fallback })
const record = (): RecordSpec => ({ kind: 'record', fallback: {} })
const switchboard = (): SwitchSpec => ({ kind: 'switchboard' })
const choice = (options: readonly string[], fallback: string): ChoiceSpec => ({ kind: 'choice', options, fallback })
const text = (max: number, fallback: string): TextSpec => ({ kind: 'text', max, fallback })

export const SETTINGS_SPEC = {
  maxRounds: integer(1, 10, 3),
  maxCharacters: integer(1, 30, 4),
  memory: { flaky: flag(true), recall: integer(1, 30, 12), lookup: flag(true), lookupCalls: integer(1, 20, 5), verify: flag(true), backlogRounds: integer(1, 100, 6), overRetrieve: integer(1, 10, 4), associate: integer(0, 10, 2), diversity: ratio(0, 1, 0.3), foldedFade: ratio(0.05, 1, 0.5) },
  context: {
    limitTokens: integer(0, 1_000_000, 0),
    limitRatio: ratio(0.1, 0.9, 0.6),
    retainRatio: ratio(0.1, 0.9, 0.5),
    shortTermTokens: integer(200, 20_000, 1500),
    longTermTokens: integer(200, 40_000, 2500),
  },
  authoring: { enabled: flag(true), perTurn: integer(1, 5, 2), thingsPerTurn: integer(0, 20, 4), consolidateAfter: integer(1, 20, 3) },
  clock: { mode: choice(CLOCK_MODES, 'simulated'), timeZone: text(64, ''), roundSeconds: integer(0, 3600, 30), maxSkipDays: integer(1, 3650, 30) },
  diagnostics: { keepRuns: flag(false) },
  offstage: { perTurn: integer(0, 5, 2), perCharacter: integer(1, 3, 1), joint: flag(true), summary: flag(true) },
  sampling: { master: ratio(0, 2, 0.7), characters: ratio(0, 2, 0.8), suggestions: ratio(0, 2, 0.2), authoring: ratio(0, 2, 0.4), records: ratio(0, 2, 0.1), tools: choice(['auto', 'required'], 'required'), maxTokens: integer(256, 64000, 8000), shortMaxTokens: integer(256, 64000, 2000), headroom: ratio(1, 10, 2) },
  prompts: { language: text(8, 'en') },
  reasoning: { children: text(40, '') },
  factions: { perTurn: integer(0, 3, 1), everyDays: integer(1, 365, 3) },
  reflection: { auto: flag(true), everyTurns: integer(0, 500, 20), onSceneChange: flag(true), sceneDays: integer(0, 365, 1), minTurns: integer(1, 100, 5), perRun: integer(1, 6, 3), minNew: integer(1, 50, 4) },
  models: { characters: text(200, ''), background: text(200, ''), records: text(200, ''), suggestions: text(200, ''), authoring: text(200, '') },
  triggers: { enabled: flag(true), maxFires: integer(1, 10, 3), beatTurns: integer(1, 20, 3), cueTurns: integer(1, 20, 2), judgedPerTurn: integer(0, 5, 2) },
  interface: { pack: text(60, '') },
  rewind: { keepSnapshots: integer(0, 500, 30) },
  rules: { own: text(MAX_OWN_RULES, '') },
  preview: { enabled: flag(true) },
  suggestions: { count: integer(0, 5, 3) },
  images: { mode: choice(['off', 'manual', 'every-turn'], 'manual'), references: choice(['text-only', 'prefer-reference', 'require-reference'], 'prefer-reference'), reuse: flag(true), highRes: flag(false), interpret: flag(true), interpreterModel: text(200, ''), captioner: text(200, '') },
  dice: { visibility: choice(['hidden', 'card'], 'card') },
  tools: switchboard(),
  embedding: { options: record() },
} as const satisfies Spec

const isField = (spec: FieldSpec | Spec): spec is FieldSpec => 'kind' in spec && typeof spec['kind'] === 'string'

function defaultsOf(spec: Spec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([key, entry]) => [key, isField(entry) ? (entry.kind === 'record' ? { ...entry.fallback } : entry.kind === 'switchboard' ? {} : entry.fallback) : defaultsOf(entry)]))
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

/** A model as `provider/model`: both parts present, no spaces. */
export const MODEL_NAME = /^[^\s/]+\/\S+$/

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/** What tools registered by other plugins are named: letters, digits and `_ . : -`, as MCP servers and others name theirs. */
export const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/

/** The options, or what is wrong with them. */
function parseOptions(value: unknown, name: string): EmbeddingOptions | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `"${name}" must be an object`
  const entries = Object.entries(value)
  if (entries.length > MAX_EMBEDDING_OPTIONS) return `"${name}" may have at most ${MAX_EMBEDDING_OPTIONS} options`
  const bad = entries.find(([key, entry]) => !OPTION_NAME.test(key) || !(typeof entry === 'boolean' || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))))
  if (bad !== undefined) return `"${name}.${bad[0]}" must be a number, text or true/false, under a name of letters, digits and underscores`
  return Object.fromEntries(entries) as EmbeddingOptions
}

/** The switches, or what is wrong with them. Names are not checked against any list: what this version does not know is kept for the version that does. */
export function parseSwitchboard(value: unknown, name: string): Switchboard | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `"${name}" must be an object`
  const agents = Object.entries(value)
  if (agents.length > MAX_SWITCH_AGENTS) return `"${name}" may name at most ${MAX_SWITCH_AGENTS} kinds of agent`
  const result: Switchboard = {}
  for (const [agent, switches] of agents) {
    if (!OPTION_NAME.test(agent)) return `"${name}.${agent}" is not a name of letters, digits and underscores`
    if (typeof switches !== 'object' || switches === null || Array.isArray(switches)) return `"${name}.${agent}" must be an object`
    const entries = Object.entries(switches)
    if (entries.length > MAX_SWITCHES) return `"${name}.${agent}" may name at most ${MAX_SWITCHES} tools`
    const bad = entries.find(([tool, on]) => !TOOL_NAME.test(tool) || typeof on !== 'boolean')
    if (bad !== undefined) return `"${name}.${agent}.${bad[0]}" must be true or false, under a tool's name (letters, digits and _ . : -)`
    result[agent] = Object.fromEntries(entries) as Record<string, boolean>
  }
  return result
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
      result[key] = entry.kind === 'record' ? { ...entry.fallback } : entry.kind === 'switchboard' ? {} : entry.fallback
    } else if (entry.kind === 'switchboard') {
      const board = parseSwitchboard(given, name)
      if (typeof board === 'string') problems.push(board)
      else result[key] = board
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
  for (const [kind, name] of Object.entries((parsed['models'] ?? {}) as Record<string, unknown>)) {
    if (typeof name === 'string' && name !== '' && !MODEL_NAME.test(name)) problems.push(`"models.${kind}" must be written provider/model, for example localai/qwen`)
  }
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
  /** How the latest runs of the story's helper agents went, oldest first. */
  activity: ActivityEntry[]
  /** What the story's triggers delivered lately (beats for the game master, cues for characters) and what became of each. */
  interventions: Intervention[]
  /** The state of the session's search by meaning. */
  vectors: VectorStatus
  /** Whether the characters are sorting what they took in into what they believe, and the latest time they did. */
  reflection: ReflectionStatus
  /** The mode the story's clock is in now; time that is simulated cannot be made to follow the real clock again. */
  clockMode?: ClockMode
}
