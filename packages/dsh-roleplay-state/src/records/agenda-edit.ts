import { ENGAGEMENT_STATUSES, INTENT_HORIZONS, INTENT_STATUSES, INTENT_TYPES, WEEKDAY_NAMES, type CharacterId, type Intent, type IntentPatch, type Location, type RoutineWindow } from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import { MAX_ROUTINE_WINDOWS } from '../sqlite/agenda-repositories.ts'
import type { RecordsEdit, RecordsTarget } from './edit-types.ts'
import { dayTokenProblems, readCalendar } from './calendar.ts'
import { isTimeZone, parseInstant, parseTimeOfDay } from './time.ts'

const MAX_PLAN_STEPS = 8
const MAX_LIST_ENTRY = 240
const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''
const list = <T>(value: readonly T[] | undefined): readonly T[] => value ?? []

/** What the agenda part of an edit comes to, once every part of it is known to be acceptable. */
export interface PreparedAgenda {
  intents: { character: CharacterId; intent: Intent }[]
  intentEdits: { id: number; patch: IntentPatch }[]
  engagements: { title: string; at: number; until?: number; location?: string; participants: CharacterId[]; note?: string }[]
  engagementEdits: { id: number; patch: { status?: (typeof ENGAGEMENT_STATUSES)[number]; title?: string; at?: number; until?: number; location?: string; participants?: CharacterId[]; note?: string } }[]
  routines: { character: CharacterId; windows: (Omit<RoutineWindow, 'locationId'> & { location?: string })[] }[]
  /** One-day windows to put in front of a character's routine. */
  exceptions: { character: CharacterId; window: Omit<RoutineWindow, 'locationId'> & { location?: string } }[]
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/
const isExceptionOn = (on: readonly string[], date: string): boolean => on.length === 1 && on[0] === date
const ALL_DAY = { from: '00:00', to: '23:59' }

interface Context {
  idOf: (key: string, where: string) => CharacterId | undefined
  placeKnown: (key: string, where: string) => void
  /** The existing places by key, to check the features of a place. */
  places: ReadonlyMap<string, Location>
  problems: string[]
}

/** Checks the goals, engagements and routines of an edit, and says what they would write. Problems are added to the context's. */
export function prepareAgenda(target: RecordsTarget, edit: RecordsEdit, context: Context): PreparedAgenda {
  const { idOf, placeKnown, problems } = context
  const zone = edit.timeZone ?? 'UTC'
  if (!isTimeZone(zone)) problems.push(`time_zone: "${zone}" is not a time zone`)
  const instant = (text: string | undefined, where: string): number | undefined => {
    if (text === undefined) return undefined
    try {
      return parseInstant(text, isTimeZone(zone) ? zone : 'UTC')
    } catch (error) {
      problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  const unit = (value: number | undefined, where: string): void => {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) problems.push(`${where} must be a number from 0 to 1`)
  }
  const steps = (given: readonly string[] | undefined, where: string): string[] | undefined => {
    if (given === undefined) return undefined
    if (given.length > MAX_PLAN_STEPS) problems.push(`${where}: at most ${MAX_PLAN_STEPS} entries`)
    if (given.some(step => !present(step) || step.length > MAX_LIST_ENTRY)) problems.push(`${where}: each entry is a sentence of at most ${MAX_LIST_ENTRY} characters`)
    return given.map(step => step.trim())
  }

  const intents = list(edit.intentsAdded).flatMap((spec, index) => {
    const where = `intents_added[${index}]`
    const character = idOf(spec.character, where)
    if (!INTENT_TYPES.includes(spec.type)) problems.push(`${where}: unknown type "${String(spec.type)}" (${INTENT_TYPES.join(', ')})`)
    if (!INTENT_HORIZONS.includes(spec.horizon)) problems.push(`${where}: unknown horizon "${String(spec.horizon)}" (${INTENT_HORIZONS.join(', ')})`)
    if (!present(spec.name) || spec.name.length > 120) problems.push(`${where}: give the goal a name of at most 120 characters`)
    unit(spec.priority, `${where}.priority`)
    unit(spec.urgency, `${where}.urgency`)
    const plan = steps(spec.plan, `${where}.plan`)
    const constraints = steps(spec.constraints, `${where}.constraints`)
    const deadline = spec.deadline === undefined ? undefined : instant(spec.deadline, `${where}.deadline`)
    if (character === undefined) return []
    return [{ character, intent: {
      type: spec.type, name: spec.name.trim(), description: spec.description?.trim() ?? '', status: 'active' as const, horizon: spec.horizon, priority: spec.priority, urgency: spec.urgency,
      plan: plan ?? [], openThreads: [], constraints: constraints ?? [], ...(deadline === undefined ? {} : { deadline: new Date(deadline).toISOString() }),
    } }]
  })

  const intentEdits = list(edit.intentEdits).map((change, index) => {
    const where = `intent_edits[${index}]`
    if (target.intents.get(change.id) === undefined) problems.push(`${where}: there is no goal ${change.id} (read_records shows the ids)`)
    if (change.status !== undefined && !INTENT_STATUSES.includes(change.status)) problems.push(`${where}: unknown status "${String(change.status)}" (${INTENT_STATUSES.join(', ')})`)
    if (change.horizon !== undefined && !INTENT_HORIZONS.includes(change.horizon)) problems.push(`${where}: unknown horizon "${String(change.horizon)}"`)
    unit(change.priority, `${where}.priority`)
    unit(change.urgency, `${where}.urgency`)
    const plan = steps(change.plan, `${where}.plan`)
    const openThreads = steps(change.openThreads, `${where}.open_threads`)
    const deadline = change.deadline === undefined ? undefined : instant(change.deadline, `${where}.deadline`)
    const patch: IntentPatch = {
      ...(change.status === undefined ? {} : { status: change.status }), ...(change.horizon === undefined ? {} : { horizon: change.horizon }),
      ...(change.description === undefined ? {} : { description: change.description.trim() }),
      ...(change.priority === undefined ? {} : { priority: change.priority }), ...(change.urgency === undefined ? {} : { urgency: change.urgency }),
      ...(plan === undefined ? {} : { plan }), ...(openThreads === undefined ? {} : { openThreads }),
      ...(deadline === undefined ? {} : { deadline: new Date(deadline).toISOString() }),
    }
    if (Object.keys(patch).length === 0) problems.push(`${where}: nothing to change`)
    return { id: change.id, patch }
  })

  const engagements = list(edit.engagements).flatMap((spec, index) => {
    const where = `engagements[${index}]`
    if (!present(spec.title) || spec.title.length > 200) problems.push(`${where}: give it a title of at most 200 characters`)
    const at = instant(spec.at, `${where}.at`)
    const until = spec.until === undefined ? undefined : instant(spec.until, `${where}.until`)
    if (at !== undefined && until !== undefined && until < at) problems.push(`${where}: it cannot end before it is due`)
    if (spec.location !== undefined) placeKnown(spec.location, `${where}.location`)
    const participants = list(spec.participants).flatMap(key => idOf(key, `${where}.participants`) ?? [])
    if (list(spec.participants).length === 0) problems.push(`${where}: say who has committed to it (participants)`)
    return at === undefined ? [] : [{ title: spec.title.trim(), at, ...(until === undefined ? {} : { until }), ...(spec.location === undefined ? {} : { location: spec.location }), participants, ...(spec.note === undefined ? {} : { note: spec.note.trim() }) }]
  })

  const engagementEdits = list(edit.engagementEdits).map((change, index) => {
    const where = `engagement_edits[${index}]`
    const current = target.engagements.get(change.id)
    if (current === undefined) problems.push(`${where}: there is no engagement ${change.id} (read_records shows the ids)`)
    if (change.status !== undefined && !ENGAGEMENT_STATUSES.includes(change.status)) problems.push(`${where}: unknown status "${String(change.status)}" (${ENGAGEMENT_STATUSES.join(', ')})`)
    if (change.title !== undefined && !present(change.title)) problems.push(`${where}: the title cannot be empty`)
    const at = change.at === undefined ? undefined : instant(change.at, `${where}.at`)
    const until = change.until === undefined ? undefined : instant(change.until, `${where}.until`)
    if ((at ?? current?.at) !== undefined && until !== undefined && until < (at ?? current!.at)) problems.push(`${where}: it cannot end before it is due`)
    if (change.location !== undefined) placeKnown(change.location, `${where}.location`)
    const participants = change.participants === undefined ? undefined : change.participants.flatMap(key => idOf(key, `${where}.participants`) ?? [])
    if (change.participants !== undefined && change.participants.length === 0) problems.push(`${where}: it needs at least one participant`)
    const patch = {
      ...(change.status === undefined ? {} : { status: change.status }), ...(change.title === undefined ? {} : { title: change.title.trim() }),
      ...(at === undefined ? {} : { at }), ...(until === undefined ? {} : { until }), ...(change.location === undefined ? {} : { location: change.location }),
      ...(participants === undefined ? {} : { participants }), ...(change.note === undefined ? {} : { note: change.note.trim() }),
    }
    if (Object.keys(patch).length === 0) problems.push(`${where}: nothing to change`)
    return { id: change.id, patch }
  })

  const routines = list(edit.routines).flatMap((set, index) => {
    const where = `routines[${index}]`
    const character = idOf(set.character, where)
    if (list(set.windows).length > MAX_ROUTINE_WINDOWS) problems.push(`${where}: at most ${MAX_ROUTINE_WINDOWS} windows in a day`)
    const windows = list(set.windows).flatMap((window, at) => {
      const here = `${where}.windows[${at}]`
      const start = parseTimeOfDay(window.from)
      const end = parseTimeOfDay(window.to)
      if (start === undefined) problems.push(`${here}.from: "${window.from}" is not a time of day (HH:MM)`)
      if (end === undefined) problems.push(`${here}.to: "${window.to}" is not a time of day (HH:MM)`)
      if (start !== undefined && start === end) problems.push(`${here}: it starts and ends at the same time`)
      if (!present(window.activity)) problems.push(`${here}: say what the character is doing`)
      const days = list(window.days).flatMap((day) => {
        const found = WEEKDAY_NAMES.indexOf(day as (typeof WEEKDAY_NAMES)[number])
        if (found < 0) problems.push(`${here}.days: "${day}" is not a day (${WEEKDAY_NAMES.join(', ')})`)
        return found < 0 ? [] : [found]
      })
      const holidays = new Set(readCalendar(target.metadata).holidays.map(holiday => holiday.id))
      problems.push(...dayTokenProblems(list(window.on), `${here}.on`, holidays))
      if (window.location !== undefined) {
        placeKnown(window.location, `${here}.location`)
        const place = context.places.get(window.location)
        if (window.feature !== undefined && place !== undefined && !place.features.some(feature => feature.key === window.feature)) problems.push(`${here}: ${place.name} has no feature "${window.feature}"`)
      } else if (window.feature !== undefined) problems.push(`${here}: a feature needs a location`)
      if (start === undefined || end === undefined) return []
      return [{
        days, on: [...list(window.on)], start, end, activity: window.activity.trim(), interruptible: window.interruptible ?? true,
        ...(window.location === undefined ? {} : { location: window.location }), ...(window.feature === undefined ? {} : { featureKey: window.feature }),
        ...(window.position === undefined || window.position.trim() === '' ? {} : { position: window.position.trim() }),
      }]
    })
    return character === undefined ? [] : [{ character, windows }]
  })

  const exceptions = list(edit.routineExceptions).flatMap((spec, index) => {
    const where = `routine_exceptions[${index}]`
    const character = idOf(spec.character, where)
    if (!FULL_DATE.test(spec.date)) problems.push(`${where}.date: "${spec.date}" is not a date (YYYY-MM-DD)`)
    else problems.push(...dayTokenProblems([spec.date], `${where}.date`))
    if (!present(spec.activity)) problems.push(`${where}: say what the character does that day`)
    if ((spec.from === undefined) !== (spec.to === undefined)) problems.push(`${where}: give both from and to, or neither for the whole day`)
    const start = parseTimeOfDay(spec.from ?? ALL_DAY.from)
    const end = parseTimeOfDay(spec.to ?? ALL_DAY.to)
    if (start === undefined) problems.push(`${where}.from: "${spec.from}" is not a time of day (HH:MM)`)
    if (end === undefined) problems.push(`${where}.to: "${spec.to}" is not a time of day (HH:MM)`)
    if (start !== undefined && start === end) problems.push(`${where}: it starts and ends at the same time`)
    if (spec.location !== undefined) {
      placeKnown(spec.location, `${where}.location`)
      const place = context.places.get(spec.location)
      if (spec.feature !== undefined && place !== undefined && !place.features.some(feature => feature.key === spec.feature)) problems.push(`${where}: ${place.name} has no feature "${spec.feature}"`)
    } else if (spec.feature !== undefined) problems.push(`${where}: a feature needs a location`)
    if (character === undefined || start === undefined || end === undefined) return []
    return [{
      character,
      window: {
        days: [], on: [spec.date], start, end, activity: spec.activity.trim(), interruptible: spec.interruptible ?? true,
        ...(spec.location === undefined ? {} : { location: spec.location }), ...(spec.feature === undefined ? {} : { featureKey: spec.feature }),
        ...(spec.position === undefined || spec.position.trim() === '' ? {} : { position: spec.position.trim() }),
      },
    }]
  })

  return { intents, intentEdits, engagements, engagementEdits, routines, exceptions }
}

/** Writes what {@link prepareAgenda} found acceptable; returns how many rows were written. */
export function writeAgenda(target: RecordsTarget, prepared: PreparedAgenda, turn: number, placeId: (key: string) => number): number {
  let writes = 0
  for (const { character, intent } of prepared.intents) { target.intents.add(character, intent); writes += 1 }
  for (const { id, patch } of prepared.intentEdits) { target.intents.update(id, patch); writes += 1 }
  for (const spec of prepared.engagements) {
    target.engagements.add({ title: spec.title, at: spec.at, ...(spec.until === undefined ? {} : { until: spec.until }), ...(spec.location === undefined ? {} : { locationId: placeId(spec.location) }), participants: spec.participants, ...(spec.note === undefined ? {} : { note: spec.note }), turn })
    writes += 1
  }
  for (const { id, patch } of prepared.engagementEdits) {
    const { location, ...rest } = patch
    try {
      target.engagements.update(id, { ...rest, ...(location === undefined ? {} : { locationId: placeId(location) }), turn })
    } catch (error) {
      throw error instanceof Error ? new InvalidEditError([`engagement_edits: ${error.message}`]) : error
    }
    writes += 1
  }
  for (const set of prepared.routines) {
    target.routines.replace(set.character, set.windows.map(({ location, ...window }) => ({ ...window, ...(location === undefined ? {} : { locationId: placeId(location) }) })))
    writes += 1
  }
  for (const { character, window } of prepared.exceptions) {
    const date = window.on![0]!
    const kept = target.routines.list(character).filter(existing => !isExceptionOn(existing.on, date))
    if (kept.length + 1 > MAX_ROUTINE_WINDOWS) throw new InvalidEditError([`routine_exceptions: the character's day already has ${MAX_ROUTINE_WINDOWS} windows`])
    const { location, ...rest } = window
    // First in the list, because the first window that fits a day is the one that applies.
    target.routines.replace(character, [{ ...rest, ...(location === undefined ? {} : { locationId: placeId(location) }) }, ...kept])
    writes += 1
  }
  return writes
}
