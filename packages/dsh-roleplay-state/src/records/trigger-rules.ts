import { COMPARISONS, WEEKDAY_NAMES, type Comparison, type Trigger, type TriggerAnnouncement, type TriggerAudience, type TriggerCondition, type TriggerDefinition, type TriggerEffect, type VariableValue } from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import { characterKey, locationKey, type RecordsTarget } from './edit-types.ts'
import { itemKey } from './items.ts'
import { inWindow, localTime, parseInstant, parseTimeOfDay } from './time.ts'
import { subjectOf } from './variables.ts'

export type Wire = Record<string, unknown>
const isObject = (value: unknown): value is Wire => typeof value === 'object' && value !== null && !Array.isArray(value)

/** How deep a condition may nest and how many parts it may have: a trigger is a rule, not a program. */
const MAX_DEPTH = 4
const MAX_NODES = 24
const MAX_EFFECTS = 6
const MAX_TEXT = 1000
const MAX_JUDGED = 300

const text = (entry: Wire, key: string): string | undefined => (typeof entry[key] === 'string' && entry[key].trim() !== '' ? entry[key].trim() : undefined)

function parseCondition(value: unknown, path: string, problems: string[], count: { nodes: number }, depth = 0): TriggerCondition | undefined {
  count.nodes += 1
  if (count.nodes > MAX_NODES) { if (count.nodes === MAX_NODES + 1) problems.push(`${path}: a condition has at most ${MAX_NODES} parts`); return undefined }
  if (depth > MAX_DEPTH) { problems.push(`${path}: conditions nest at most ${MAX_DEPTH} deep`); return undefined }
  if (!isObject(value)) { problems.push(`${path}: a condition is an object`); return undefined }
  const need = (key: string): string | undefined => {
    const found = text(value, key)
    if (found === undefined) problems.push(`${path}.${key}: required text`)
    return found
  }
  switch (value['type']) {
    case 'time': {
      const from = text(value, 'from')
      const to = text(value, 'to')
      const window = isObject(value['window']) ? { from: text(value['window'], 'from') ?? '', to: text(value['window'], 'to') ?? '' } : undefined
      const days = Array.isArray(value['days']) ? value['days'].filter((day): day is string => typeof day === 'string') : undefined
      if (from === undefined && to === undefined && window === undefined && days === undefined) { problems.push(`${path}: a time condition needs from, to, window or days`); return undefined }
      if (window !== undefined && (parseTimeOfDay(window.from) === undefined || parseTimeOfDay(window.to) === undefined || window.from === window.to)) problems.push(`${path}.window: from and to are different times of day, HH:MM`)
      for (const day of days ?? []) if (!(WEEKDAY_NAMES as readonly string[]).includes(day)) problems.push(`${path}.days: "${day}" is not mon to sun`)
      if (value['days'] !== undefined && days?.length !== (value['days'] as unknown[] | undefined)?.length) problems.push(`${path}.days: a list of mon to sun`)
      return { type: 'time', ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(window === undefined ? {} : { window }), ...(days === undefined ? {} : { days }) }
    }
    case 'place': {
      const character = need('character'); const location = need('location'); const feature = text(value, 'feature')
      return character === undefined || location === undefined ? undefined : { type: 'place', character, location, ...(feature === undefined ? {} : { feature }) }
    }
    case 'variable': {
      const variable = need('variable'); const subject = text(value, 'subject')
      const op = value['op'] as Comparison
      const found = value['value']
      if (!COMPARISONS.includes(op)) problems.push(`${path}.op: one of ${COMPARISONS.join(', ')}`)
      if (typeof found !== 'number' && typeof found !== 'string' && typeof found !== 'boolean') problems.push(`${path}.value: a number, text or yes/no`)
      return variable === undefined || !COMPARISONS.includes(op) || (typeof found !== 'number' && typeof found !== 'string' && typeof found !== 'boolean')
        ? undefined : { type: 'variable', variable, ...(subject === undefined ? {} : { subject }), op, value: found }
    }
    case 'item': {
      const item = need('item'); const heldBy = text(value, 'held_by'); const at = text(value, 'at')
      if ((heldBy === undefined) === (at === undefined)) { problems.push(`${path}: give exactly one of held_by and at`); return undefined }
      return item === undefined ? undefined : { type: 'item', item, ...(heldBy === undefined ? {} : { heldBy }), ...(at === undefined ? {} : { at }) }
    }
    case 'event': { const tag = need('tag'); return tag === undefined ? undefined : { type: 'event', tag: tag.toLowerCase() } }
    case 'fired': { const trigger = need('trigger'); return trigger === undefined ? undefined : { type: 'fired', trigger } }
    case 'judged': {
      const statement = need('text')
      if (statement !== undefined && statement.length > MAX_JUDGED) { problems.push(`${path}.text: at most ${MAX_JUDGED} characters`); return undefined }
      return statement === undefined ? undefined : { type: 'judged', text: statement }
    }
    case 'all':
    case 'any': {
      if (!Array.isArray(value['conditions']) || value['conditions'].length === 0) { problems.push(`${path}.conditions: a list with at least one condition`); return undefined }
      const parts = value['conditions'].map((part, index) => parseCondition(part, `${path}.conditions[${index}]`, problems, count, depth + 1))
      return parts.every(part => part !== undefined) ? { type: value['type'], conditions: parts as TriggerCondition[] } : undefined
    }
    case 'not': {
      const inner = parseCondition(value['condition'], `${path}.condition`, problems, count, depth + 1)
      return inner === undefined ? undefined : { type: 'not', condition: inner }
    }
    default:
      problems.push(`${path}.type: one of time, place, variable, item, event, fired, judged, all, any, not`)
      return undefined
  }
}

function parseAudience(value: unknown, path: string, problems: string[]): TriggerAudience | undefined {
  if (value === 'everyone') return 'everyone'
  if (isObject(value) && Array.isArray(value['characters']) && value['characters'].length > 0 && value['characters'].every(entry => typeof entry === 'string' && entry.trim() !== '')) return { characters: value['characters'] as string[] }
  if (isObject(value) && typeof value['place'] === 'string' && value['place'].trim() !== '') return { place: value['place'].trim() }
  problems.push(`${path}: "everyone", {"characters": [the characters]} or {"place": the place}`)
  return undefined
}

const localTimeProblem = (value: string): boolean => { try { parseInstant(value, 'UTC'); return false } catch { return true } }

function parseAnnouncement(value: unknown, path: string, problems: string[]): TriggerAnnouncement | undefined {
  if (!isObject(value)) { problems.push(`${path}: an announcement is an object: who knows, and what is known`); return undefined }
  const audience = parseAudience(value['audience'], `${path}.audience`, problems)
  const words = text(value, 'text')
  if (words === undefined || words.length > 500) problems.push(`${path}.text: required text of at most 500 characters`)
  const from = text(value, 'from')
  const at = text(value, 'at')
  for (const [field, found] of [['from', from], ['at', at]] as const) if (found !== undefined && localTimeProblem(found)) problems.push(`${path}.${field}: a local date and time, 1912-10-04T19:30`)
  return audience === undefined || words === undefined ? undefined : { audience, text: words, ...(from === undefined ? {} : { from }), ...(at === undefined ? {} : { at }) }
}

/** Checks that an edit effect is shaped as an edit; it throws {@link InvalidEditError} when not. */
export type EditChecker = (edit: Wire) => void

function parseEffect(value: unknown, path: string, problems: string[], checkEdit: EditChecker): TriggerEffect | undefined {
  if (!isObject(value)) { problems.push(`${path}: an effect is an object`); return undefined }
  if (value['type'] === 'edit') {
    if (!isObject(value['edit'])) { problems.push(`${path}.edit: an edit, as the record keeper writes one`); return undefined }
    try { checkEdit({ turn: 0, ...value['edit'] }) } catch (error) { problems.push(`${path}.edit: ${error instanceof InvalidEditError ? error.problems.join('; ') : String(error)}`); return undefined }
    return { type: 'edit', edit: value['edit'] }
  }
  if (value['type'] !== 'beat' && value['type'] !== 'cue') { problems.push(`${path}.type: one of edit, beat, cue`); return undefined }
  const words = text(value, 'text')
  if (words === undefined || words.length > MAX_TEXT) { problems.push(`${path}.text: required text of at most ${MAX_TEXT} characters`); return undefined }
  if (value['type'] === 'beat') return { type: 'beat', text: words }
  if (value['type'] === 'cue') {
    const audience = value['audience'] !== undefined ? parseAudience(value['audience'], `${path}.audience`, problems) : parseAudience({ characters: value['characters'] }, `${path}.characters`, problems)
    return audience === undefined ? undefined : { type: 'cue', audience, text: words }
  }
  problems.push(`${path}.type: one of edit, beat, cue`)
  return undefined
}

/**
 * Read a trigger from the JSON a world's files and the world author write (snake_case).
 * @returns the definition, or every problem with where it is.
 */
export function parseTriggerDefinition(value: unknown, path: string, checkEdit: EditChecker): { definition: TriggerDefinition } | { problems: string[] } {
  const problems: string[] = []
  if (!isObject(value)) return { problems: [`${path}: a trigger is an object`] }
  const key = text(value, 'key'); const name = text(value, 'name')
  if (key === undefined) problems.push(`${path}.key: required text`)
  if (name === undefined) problems.push(`${path}.name: required text`)
  const condition = parseCondition(value['when'], `${path}.when`, problems, { nodes: 0 })
  const rawEffects = value['effects']
  if (!Array.isArray(rawEffects) || rawEffects.length === 0 || rawEffects.length > MAX_EFFECTS) problems.push(`${path}.effects: a list of one to ${MAX_EFFECTS} effects`)
  const effects = Array.isArray(rawEffects) ? rawEffects.slice(0, MAX_EFFECTS).map((effect, index) => parseEffect(effect, `${path}.effects[${index}]`, problems, checkEdit)) : []
  const number = (field: string): number | undefined => (typeof value[field] === 'number' ? value[field] : undefined)
  if (value['repeat'] !== undefined && typeof value['repeat'] !== 'boolean') problems.push(`${path}.repeat: yes or no`)
  for (const field of ['cooldown_seconds', 'chance', 'priority']) if (value[field] !== undefined && typeof value[field] !== 'number') problems.push(`${path}.${field}: a number`)
  const chance = number('chance'); const cooldown = number('cooldown_seconds')
  if (chance !== undefined && (chance < 0 || chance > 1)) problems.push(`${path}.chance: from 0 to 1`)
  if (cooldown !== undefined && (!Number.isSafeInteger(cooldown) || cooldown < 0)) problems.push(`${path}.cooldown_seconds: a whole number of seconds`)
  const expires = text(value, 'expires')
  const announce = value['announce'] === undefined ? undefined : parseAnnouncement(value['announce'], `${path}.announce`, problems)
  if (expires !== undefined) { try { parseInstant(expires, 'UTC') } catch { problems.push(`${path}.expires: a local date and time, 1912-10-04T19:30`) } }
  if (problems.length > 0 || key === undefined || name === undefined || condition === undefined) return { problems }
  return {
    definition: {
      key, name, condition, effects: effects as TriggerEffect[], repeat: value['repeat'] === true, priority: number('priority') ?? 0,
      ...(cooldown === undefined ? {} : { cooldownSeconds: cooldown }), ...(chance === undefined ? {} : { chance }), ...(expires === undefined ? {} : { expires }), ...(announce === undefined ? {} : { announce }),
    },
  }
}

type Reading = Pick<RecordsTarget, 'characters' | 'locations' | 'items' | 'variables' | 'triggers'>

function conditionProblems(target: Reading, condition: TriggerCondition, path: string, known: ReadonlySet<string>): string[] {
  const character = (key: string): string[] => (target.characters.list().some(entry => characterKey(entry) === key) ? [] : [`${path}: there is no character "${key}"`])
  const place = (key: string): string[] => (target.locations.list().some(entry => locationKey(entry) === key) ? [] : [`${path}: there is no place "${key}"`])
  switch (condition.type) {
    case 'time': return []
    case 'place': return [...character(condition.character), ...place(condition.location)]
    case 'variable': {
      const def = target.variables.def(condition.variable)
      if (def === undefined) return [`${path}: there is no variable "${condition.variable}"`]
      if (def.subject === 'world' ? condition.subject !== undefined : condition.subject === undefined) return [`${path}: ${def.subject === 'world' ? 'a world variable has no subject' : `give the ${def.subject} it is about as subject`}`]
      const subject = condition.subject === undefined ? undefined : subjectOf(target, def.subject, condition.subject)
      return [
        ...(condition.subject !== undefined && subject === undefined ? [`${path}: there is no ${def.subject} "${condition.subject}"`] : []),
        ...(def.kind !== 'number' && condition.op !== 'eq' && condition.op !== 'ne' ? [`${path}: ${def.kind} variables compare with eq or ne only`] : []),
      ]
    }
    case 'item': return [
      ...(target.items.list().some(entry => itemKey(entry) === condition.item) ? [] : [`${path}: there is no item "${condition.item}"`]),
      ...(condition.heldBy === undefined ? [] : character(condition.heldBy)), ...(condition.at === undefined ? [] : place(condition.at)),
    ]
    case 'event': return []
    case 'fired': return known.has(condition.trigger) ? [] : [`${path}: there is no trigger "${condition.trigger}"`]
    case 'judged': return []
    case 'all': case 'any': return condition.conditions.flatMap((part, index) => conditionProblems(target, part, `${path}.conditions[${index}]`, known))
    case 'not': return conditionProblems(target, condition.condition, `${path}.condition`, known)
  }
}

/**
 * What in a trigger names something the story does not have: a character, place, item or variable in a condition, the characters of a cue,
 * a trigger it waits for. (What an edit effect touches is checked when it is applied.)
 */
export function triggerReferenceProblems(target: Reading, definition: TriggerDefinition, otherKeys: Iterable<string> = []): string[] {
  const known = new Set([...target.triggers.list().map(trigger => trigger.key), ...otherKeys])
  const audience = (who: TriggerAudience, path: string): string[] => {
    if (who === 'everyone') return []
    if ('place' in who) return target.locations.list().some(entry => locationKey(entry) === who.place) ? [] : [`${path}: there is no place "${who.place}"`]
    return who.characters.flatMap(key => (target.characters.list().some(entry => characterKey(entry) === key) ? [] : [`${path}: there is no character "${key}"`]))
  }
  const cues = definition.effects.flatMap((effect, index) => (effect.type !== 'cue' ? [] : audience(effect.audience, `effects[${index}]`)))
  const announced = definition.announce === undefined ? [] : audience(definition.announce.audience, 'announce')
  return [...conditionProblems(target, definition.condition, 'when', known), ...cues, ...announced].map(problem => `${definition.key}: ${problem}`)
}

const COMPARE: Record<Comparison, (a: number, b: number) => boolean> = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b }

function compare(op: Comparison, have: VariableValue, want: VariableValue): boolean {
  if (typeof have === 'number' && typeof want === 'number') return COMPARE[op](have, want)
  return op === 'ne' ? have !== want : op === 'eq' ? have === want : false
}

export interface TriggerClock {
  now: number
  zone: string
  /** Whether a model has judged a statement true; a statement nobody judged is false. */
  judged?: (statement: string) => boolean
}

/** The statements of the `judged` parts of a condition, in order, each once. */
export function judgedStatements(condition: TriggerCondition): string[] {
  switch (condition.type) {
    case 'judged': return [condition.text]
    case 'all': case 'any': return [...new Set(condition.conditions.flatMap(judgedStatements))]
    case 'not': return judgedStatements(condition.condition)
    default: return []
  }
}

function holds(target: RecordsTarget, condition: TriggerCondition, clock: TriggerClock): boolean {
  switch (condition.type) {
    case 'time': {
      const { now, zone } = clock
      if (condition.from !== undefined && now < parseInstant(condition.from, zone)) return false
      if (condition.to !== undefined && now >= parseInstant(condition.to, zone)) return false
      const local = localTime(now, zone)
      if (condition.window !== undefined) {
        const start = parseTimeOfDay(condition.window.from) ?? 0
        const end = parseTimeOfDay(condition.window.to) ?? 0
        if (!inWindow(local.minuteOfDay, start, end)) return false
        const weekday = start > end && local.minuteOfDay < end ? (local.weekday + 6) % 7 : local.weekday
        return condition.days === undefined || condition.days.length === 0 || condition.days.includes(WEEKDAY_NAMES[weekday] ?? '')
      }
      return condition.days === undefined || condition.days.length === 0 || condition.days.includes(WEEKDAY_NAMES[local.weekday] ?? '')
    }
    case 'place': {
      const who = target.characters.list().find(entry => characterKey(entry) === condition.character)
      const where = target.locations.list().find(entry => locationKey(entry) === condition.location)
      const placement = who === undefined ? undefined : target.placements.get('character', who.id)
      return placement !== undefined && where !== undefined && placement.locationId === where.id && (condition.feature === undefined || placement.featureKey === condition.feature)
    }
    case 'variable': {
      const def = target.variables.def(condition.variable)
      if (def === undefined) return false
      const subject = def.subject === 'world' ? { id: 0 } : condition.subject === undefined ? undefined : subjectOf(target, def.subject, condition.subject)
      return subject !== undefined && compare(condition.op, target.variables.value(condition.variable, def.subject, subject.id), condition.value)
    }
    case 'item': {
      const item = target.items.list().find(entry => itemKey(entry) === condition.item)
      if (item === undefined) return false
      const where = target.items.where(item.id)
      if (condition.heldBy !== undefined) return where.characterId !== undefined && where.characterId === target.characters.list().find(entry => characterKey(entry) === condition.heldBy)?.id
      return where.locationId !== undefined && where.locationId === target.locations.list().find(entry => locationKey(entry) === condition.at)?.id
    }
    case 'event': return target.events.list().some(event => event.tags.includes(condition.tag))
    case 'fired': return (target.triggers.getByKey(condition.trigger)?.fireCount ?? 0) > 0
    case 'judged': return clock.judged?.(condition.text) ?? false
    case 'all': return condition.conditions.every(part => holds(target, part, clock))
    case 'any': return condition.conditions.some(part => holds(target, part, clock))
    case 'not': return !holds(target, condition.condition, clock)
  }
}

/** Whether a condition holds now, judged only from what the story has recorded. */
export const conditionHolds = holds

/** A number from 0 to 1 that depends only on what it is given: a roll that comes out the same when the story is replayed. */
export function seededRoll(seed: string): number {
  let hash = 2166136261
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return ((hash >>> 0) % 1_000_000) / 1_000_000
}


/** When a trigger waits for a plain time, that time: what an announcement says it is to happen at, unless it says so itself. */
function waitedFor(condition: TriggerCondition): string | undefined {
  if (condition.type === 'time') return condition.from
  if (condition.type === 'all') return condition.conditions.map(waitedFor).find(found => found !== undefined)
  return undefined
}

/** A character is among those an audience names, now. */
export function inAudience(target: Pick<RecordsTarget, 'characters' | 'locations' | 'placements'>, audience: TriggerAudience, characterId: number): boolean {
  if (audience === 'everyone') return true
  if ('characters' in audience) return audience.characters.some(key => target.characters.list().find(entry => characterKey(entry) === key)?.id === characterId)
  const place = target.locations.list().find(entry => locationKey(entry) === audience.place)
  return place !== undefined && target.placements.get('character', characterId)?.locationId === place.id
}

/** The characters an audience is now, those who can be asked to act (the player's own character is told by the game master). */
export function audienceIds(target: Pick<RecordsTarget, 'characters' | 'locations' | 'placements'>, audience: TriggerAudience): number[] {
  return target.characters.list().filter(entry => entry.control === 'agent' && inAudience(target, audience, entry.id)).map(entry => entry.id)
}

export interface Announcement {
  trigger: Trigger
  text: string
  audience: TriggerAudience
  /** When it is to happen, as an instant, when that is known. */
  at?: number
}

/** What is known of what is coming: triggers that have not fired and announce themselves, from the time they say, soonest first. */
export function announcements(target: Pick<RecordsTarget, 'triggers'>, clock: TriggerClock): Announcement[] {
  return target.triggers.list({ status: 'dormant' }).flatMap((trigger): Announcement[] => {
    const { announce } = trigger
    if (announce === undefined || (announce.from !== undefined && clock.now < parseInstant(announce.from, clock.zone))) return []
    const when = announce.at ?? waitedFor(trigger.condition)
    return [{ trigger, text: announce.text, audience: announce.audience, ...(when === undefined ? {} : { at: parseInstant(when, clock.zone) }) }]
  }).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.trigger.id - b.trigger.id)
}
