import {
  CHARACTER_KINDS,
  CHARACTER_ROLES,
  CHARACTER_TIERS,
  INTENT_HORIZONS,
  INTENT_STATUSES,
  INTENT_TYPES,
  type CharacterDefinition,
  type CharacterStart,
  type EmotionStart,
  type EmotionVector,
  type Intent,
  type RelationshipDefinition,
} from 'dsh-roleplay-model'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const CHARACTER_FILE_NAME = 'character.json'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function readAge(reader: Reader): string | undefined {
  const value = reader.raw('age')
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) return String(value)
  } else if (value === undefined || typeof value === 'string') {
    return reader.string('age')
  }
  reader.fail('age', 'must be a string or a non-negative number')
  return undefined
}

function readVector(reader: Reader): EmotionVector {
  const axis = (key: string): number => reader.number(key, { min: -1, max: 1 }) ?? 0
  return { valence: axis('valence'), arousal: axis('arousal'), dominance: axis('dominance') }
}

function readEmotion(reader: Reader | undefined): EmotionStart | undefined {
  if (reader === undefined) return undefined
  const baselineReader = reader.object('baseline')
  if (baselineReader === undefined) {
    reader.fail('baseline', 'is required')
    return undefined
  }
  const baseline = readVector(baselineReader)
  const immediateReader = reader.object('immediate')
  return { baseline, immediate: immediateReader === undefined ? { ...baseline } : readVector(immediateReader) }
}

function readIntent(reader: Reader): Intent | undefined {
  const name = reader.string('name', { required: true })
  const deadline = reader.string('deadline')
  const deadlineTime = deadline === undefined ? undefined : ISO_DATE.test(deadline) ? Date.parse(deadline) : Number.NaN
  if (deadline !== undefined && Number.isNaN(deadlineTime)) reader.fail('deadline', 'must be an ISO 8601 date-time')
  const intent = {
    type: reader.oneOf('type', INTENT_TYPES, 'agenda'),
    description: reader.text('description'),
    status: reader.oneOf('status', INTENT_STATUSES, 'active'),
    horizon: reader.oneOf('horizon', INTENT_HORIZONS, 'short'),
    priority: reader.number('priority', { min: 0, max: 1 }) ?? 0.5,
    urgency: reader.number('urgency', { min: 0, max: 1 }) ?? 0.5,
    plan: reader.strings('plan'),
    openThreads: reader.strings('open_threads'),
    constraints: reader.strings('constraints'),
    ...(deadlineTime === undefined || Number.isNaN(deadlineTime) ? {} : { deadline: new Date(deadlineTime).toISOString() }),
  }
  return name === undefined ? undefined : { ...intent, name }
}

/** At most this many relationship profiles in one character file. */
export const MAX_RELATIONSHIPS = 60

function readRelationships(reader: Reader): RelationshipDefinition[] {
  const seen = new Set<string>()
  const relationships = reader.objects('relationships').flatMap((relation): RelationshipDefinition[] => {
    const to = relation.string('to', { required: true })
    const label = relation.string('label', { required: true })
    const familiarity = relation.number('familiarity', { min: 0, max: 1 }) ?? 0
    const trust = relation.number('trust', { min: -1, max: 1 }) ?? 0
    const affinity = relation.number('affinity', { min: -1, max: 1 }) ?? 0
    const tension = relation.number('tension', { min: 0, max: 1 }) ?? 0
    if (to !== undefined && seen.has(to)) relation.fail('to', `"${to}" is listed twice: one profile per character`)
    if (to !== undefined) seen.add(to)
    return to === undefined || label === undefined ? [] : [{ to, label, summary: relation.text('summary'), familiarity, trust, affinity, tension }]
  })
  if (relationships.length > MAX_RELATIONSHIPS) reader.fail('relationships', `a character has at most ${MAX_RELATIONSHIPS} relationship profiles`)
  return relationships
}

function readStart(reader: Reader | undefined): CharacterStart {
  const emotion = readEmotion(reader?.object('emotion'))
  const location = reader?.string('location')
  const position = reader?.string('position')
  const feature = reader?.string('feature')
  if (location === undefined && (position !== undefined || feature !== undefined)) reader?.fail(position === undefined ? 'feature' : 'position', 'needs a location')
  return {
    publicState: reader?.text('public_state') ?? '',
    innerState: reader?.text('inner_state') ?? '',
    activity: reader?.text('activity') ?? '',
    ...(emotion === undefined ? {} : { emotion }),
    intents: reader?.objects('intents').flatMap(intent => readIntent(intent) ?? []) ?? [],
    ...(location === undefined ? {} : { place: { location, ...(position === undefined ? {} : { position }), ...(feature === undefined ? {} : { feature }) } }),
  }
}

/**
 * Read a `character.json` into the canonical character definition.
 * @param fallbackId - used when the file sets no `id`; the name of its folder.
 */
export function parseCharacterFile(text: string, fallbackId: string): ParseResult<CharacterDefinition> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }

  const id = readIdentifier(reader, fallbackId) ?? fallbackId
  const name = reader.string('name', { required: true })
  const kind = reader.oneOf('kind', CHARACTER_KINDS, 'person')
  const tier = reader.oneOf('tier', CHARACTER_TIERS, 'principal')
  const role = reader.oneOf('role', CHARACTER_ROLES, 'npc')
  if (role === 'playable') {
    if (kind === 'group') reader.fail('role', 'a playable character must be a person')
    if (tier === 'background') reader.fail('role', 'a playable character cannot be a background character')
  }

  const age = readAge(reader)
  const gender = reader.string('gender')
  const pronouns = reader.string('pronouns')
  const speech = reader.object('speech')
  const character: CharacterDefinition = {
    id,
    name: name ?? '',
    aliases: reader.strings('aliases').filter(alias => alias.toLowerCase() !== name?.toLowerCase()),
    ...(age === undefined ? {} : { age }),
    ...(gender === undefined ? {} : { gender }),
    ...(pronouns === undefined ? {} : { pronouns }),
    kind,
    tier,
    role,
    summary: reader.text('summary'),
    personality: reader.text('personality'),
    background: reader.text('background'),
    appearance: reader.text('appearance'),
    speech: { style: speech?.text('style') ?? '', examples: speech?.strings('examples') ?? [] },
    start: readStart(reader.object('start')),
    ...(reader.raw('relationships') === undefined ? {} : { relationships: readRelationships(reader) }),
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: character }
}
