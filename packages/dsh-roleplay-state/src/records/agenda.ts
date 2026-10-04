import type { CharacterId, CharacterIntent, Engagement, StoredRoutineWindow } from 'dsh-roleplay-model'
import type { EngagementRepository, IntentRepository, RoutineRepository } from '../repositories.ts'
import { DAY, HOUR, MINUTE, addLocalDays, parseInstant, zonedInstant } from './time.ts'

/** One occurrence of a routine window: the stretch of time it holds on a particular day. */
export interface Occurrence {
  window: StoredRoutineWindow
  startsAt: number
  endsAt: number
}

/** An engagement still pending this long after it was due (or over) is overdue. */
export const ENGAGEMENT_GRACE = 30 * MINUTE

function occurrenceOn(window: StoredRoutineWindow, day: { year: number; month: number; day: number; weekday: number }, zone: string): Occurrence | undefined {
  if (window.days.length > 0 && !window.days.includes(day.weekday)) return undefined
  const startsAt = zonedInstant({ ...day, hour: Math.floor(window.start / 60), minute: window.start % 60 }, zone)
  const wraps = window.end < window.start
  const endDay = wraps ? addLocalDays(startsAt, zone, 1) : day
  const endsAt = zonedInstant({ ...endDay, hour: Math.floor(window.end / 60), minute: window.end % 60 }, zone)
  return { window, startsAt, endsAt }
}

/** The window that holds at an instant (the first of the list that does), with the stretch of this occurrence of it. */
export function occurrenceAt(windows: readonly StoredRoutineWindow[], now: number, zone: string): Occurrence | undefined {
  const days = [addLocalDays(now, zone, 0), addLocalDays(now, zone, -1)]
  for (const window of windows) {
    for (const day of days) {
      const occurrence = occurrenceOn(window, day, zone)
      if (occurrence !== undefined && occurrence.startsAt <= now && now < occurrence.endsAt) return occurrence
    }
  }
  return undefined
}

/** The window that starts next after an instant, within `horizon`. */
export function nextOccurrence(windows: readonly StoredRoutineWindow[], now: number, zone: string, horizon: number): Occurrence | undefined {
  let best: Occurrence | undefined
  for (const offset of [0, 1, 2]) {
    const day = addLocalDays(now, zone, offset)
    for (const window of windows) {
      const occurrence = occurrenceOn(window, day, zone)
      if (occurrence === undefined || occurrence.startsAt <= now || occurrence.startsAt > now + horizon) continue
      if (best === undefined || occurrence.startsAt < best.startsAt) best = occurrence
    }
  }
  return best
}

export interface RankedGoal {
  intent: CharacterIntent
  /** The deadline as an instant, when it has one that can be read. */
  deadlineAt?: number
  overdue: boolean
  score: number
}

/** What a character is after, most pressing first: priority and urgency, and how close or past the deadline is. Goals not active are left out. */
export function rankGoals(goals: readonly CharacterIntent[], now: number, zone: string, limit: number): RankedGoal[] {
  return goals.filter(goal => goal.status === 'active').map((intent): RankedGoal => {
    let deadlineAt: number | undefined
    if (intent.deadline !== undefined) {
      try { deadlineAt = parseInstant(intent.deadline, zone) } catch { /* a deadline that is not a date does not count */ }
    }
    const left = deadlineAt === undefined ? undefined : deadlineAt - now
    const bonus = left === undefined ? 0 : left < 0 ? 0.4 : left < 6 * HOUR ? 0.3 : left < DAY ? 0.2 : left < 7 * DAY ? 0.1 : 0
    return { intent, ...(deadlineAt === undefined ? {} : { deadlineAt }), overdue: left !== undefined && left < 0, score: 0.5 * intent.priority + 0.3 * intent.urgency + bonus }
  }).sort((a, b) => b.score - a.score || a.intent.id - b.intent.id).slice(0, limit)
}

export interface AgendaEngagement {
  engagement: Engagement
  overdue: boolean
}

export interface Agenda {
  /** What the routine has the character doing now. */
  now?: Occurrence
  /** What the routine has it doing next, within the horizon. */
  next?: Occurrence
  /** What it has committed to that is due within the horizon or is overdue, in the order they are due. */
  engagements: AgendaEngagement[]
  goals: RankedGoal[]
}

export interface AgendaOptions {
  /** How far ahead to look, in milliseconds. */
  horizon?: number
  goals?: number
  engagements?: number
}

const DEFAULTS = { horizon: 24 * HOUR, goals: 3, engagements: 4 } as const

/** What a character is expected to be doing and to have done at an instant: its routine, its commitments and its goals. */
export function agendaAt(
  source: { routines: Pick<RoutineRepository, 'list'>; engagements: Pick<EngagementRepository, 'list'>; intents: Pick<IntentRepository, 'list'> },
  characterId: CharacterId,
  now: number,
  zone: string,
  options: AgendaOptions = {},
): Agenda {
  const horizon = options.horizon ?? DEFAULTS.horizon
  const windows = source.routines.list(characterId)
  const current = occurrenceAt(windows, now, zone)
  const next = nextOccurrence(windows, now, zone, horizon)
  const engagements = source.engagements.list({ status: 'pending', participant: characterId, to: now + horizon })
    .map((engagement): AgendaEngagement => ({ engagement, overdue: now > (engagement.until ?? engagement.at + ENGAGEMENT_GRACE) }))
    .slice(0, options.engagements ?? DEFAULTS.engagements)
  return {
    ...(current === undefined ? {} : { now: current }),
    ...(next === undefined ? {} : { next }),
    engagements,
    goals: rankGoals(source.intents.list(characterId), now, zone, options.goals ?? DEFAULTS.goals),
  }
}
