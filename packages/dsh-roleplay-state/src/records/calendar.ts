import { WEEKDAY_NAMES } from 'dsh-roleplay-model'

/**
 * Which days a thing applies on, beyond the days of the week: whole months, a date every year or once, a stretch of dates, the day of the month,
 * the first or last Monday of a month, a season, and the holidays a world names. A day is told by tokens (`dec`, `12-24`, `1912-09-21..1912-09-22`,
 * `dom:1`, `nth:mon:1`, `season:winter`, `holiday:founders-day`, `fri`); a token with `!` before it is a day it does not apply on. A list holds on a
 * day when it names no day to apply on or one of them is today, and none of the days to leave out is.
 */
export const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]
export type Hemisphere = 'north' | 'south'

/** A day by the wall clock of the story: the month is 1 to 12 and the weekday 0 (Sunday) to 6. */
export interface CalendarDay {
  year: number
  month: number
  day: number
  weekday: number
}

export interface Holiday {
  id: string
  name: string
  /** The days it falls on, as tokens other than `holiday:`. */
  on: string[]
}

export interface Calendar {
  hemisphere: Hemisphere
  holidays: Holiday[]
}

export const NO_CALENDAR: Calendar = { hemisphere: 'north', holidays: [] }

const MAX_TOKEN = 60

type Parsed =
  | { kind: 'weekday'; weekday: number }
  | { kind: 'month'; month: number }
  | { kind: 'date'; year?: number; month: number; day: number }
  | { kind: 'span'; from: { year?: number; month: number; day: number }; to: { year?: number; month: number; day: number } }
  | { kind: 'dom'; day: number | 'last' }
  | { kind: 'nth'; weekday: number; n: number | 'last' }
  | { kind: 'season'; season: Season }
  | { kind: 'holiday'; id: string }

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()
const DATE = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/

function dateOf(text: string): { year?: number; month: number; day: number } | undefined {
  const found = DATE.exec(text)
  if (found === null) return undefined
  const [, year, month, day] = found
  const m = Number(month)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > daysIn(year === undefined ? 2024 : Number(year), m)) return undefined
  return { ...(year === undefined ? {} : { year: Number(year) }), month: m, day: d }
}

/** What a token says, or why it says nothing. */
export function parseDayToken(raw: string): { token: Parsed; negated: boolean } | { problem: string } {
  const negated = raw.startsWith('!')
  const text = (negated ? raw.slice(1) : raw).trim().toLowerCase()
  const fail = (problem: string): { problem: string } => ({ problem: `"${raw}": ${problem}` })
  if (text === '' || text.length > MAX_TOKEN) return fail('a day is told in a few words')
  const weekday = WEEKDAY_NAMES.indexOf(text as (typeof WEEKDAY_NAMES)[number])
  if (weekday >= 0) return { token: { kind: 'weekday', weekday }, negated }
  const month = MONTH_NAMES.indexOf(text as (typeof MONTH_NAMES)[number])
  if (month >= 0) return { token: { kind: 'month', month: month + 1 }, negated }
  const one = dateOf(text)
  if (one !== undefined) return { token: { kind: 'date', ...one }, negated }
  if (text.includes('..')) {
    const [from, to, ...rest] = text.split('..')
    const start = from === undefined ? undefined : dateOf(from)
    const end = to === undefined ? undefined : dateOf(to)
    if (rest.length > 0 || start === undefined || end === undefined || (start.year === undefined) !== (end.year === undefined)) return fail('a stretch is two dates of the same kind: `12-20..01-05` every year, or `1912-09-21..1912-09-22` once')
    return { token: { kind: 'span', from: start, to: end }, negated }
  }
  const [head, a, b] = text.split(':')
  if (head === 'dom' && a !== undefined && b === undefined) {
    if (a === 'last') return { token: { kind: 'dom', day: 'last' }, negated }
    const day = Number(a)
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { token: { kind: 'dom', day }, negated } : fail('the day of the month is 1 to 31, or `dom:last`')
  }
  if (head === 'nth' && a !== undefined && b !== undefined) {
    const day = WEEKDAY_NAMES.indexOf(a as (typeof WEEKDAY_NAMES)[number])
    const n = b === 'last' ? 'last' as const : Number(b)
    return day >= 0 && (n === 'last' || (Number.isInteger(n) && n >= 1 && n <= 5)) ? { token: { kind: 'nth', weekday: day, n }, negated } : fail('`nth:mon:1` is the first Monday of a month, `nth:fri:last` the last Friday')
  }
  if (head === 'season' && a !== undefined && b === undefined) {
    const season = SEASONS.find(candidate => candidate === a)
    return season === undefined ? fail(`a season is one of ${SEASONS.join(', ')}`) : { token: { kind: 'season', season }, negated }
  }
  if (head === 'holiday' && a !== undefined && b === undefined && a !== '') return { token: { kind: 'holiday', id: a }, negated }
  return fail('not a day: use a weekday (`mon`), a month (`dec`), a date (`12-24`, `1912-09-21`), a stretch (`12-20..01-05`), `dom:1`, `nth:mon:1`, `season:winter` or `holiday:<id>`')
}

/** What is wrong with a list of day tokens, each with where it is. `holidays` are those the world names, when `holiday:` may be used. */
export function dayTokenProblems(tokens: readonly string[], path: string, holidays?: ReadonlySet<string> | 'any'): string[] {
  return tokens.flatMap((raw): string[] => {
    const parsed = parseDayToken(raw)
    if ('problem' in parsed) return [`${path}: ${parsed.problem}`]
    if (parsed.token.kind === 'holiday') {
      if (holidays === undefined) return [`${path}: "${raw}": a holiday cannot be named here`]
      if (holidays !== 'any' && !holidays.has(parsed.token.id)) return [`${path}: "${raw}": the world names no holiday "${parsed.token.id}"`]
    }
    return []
  })
}

/** The season a day is in, by the months of its hemisphere (winter is December to February in the north, June to August in the south). */
export function seasonOf(day: Pick<CalendarDay, 'month'>, hemisphere: Hemisphere = 'north'): Season {
  const north: Season = day.month === 12 || day.month <= 2 ? 'winter' : day.month <= 5 ? 'spring' : day.month <= 8 ? 'summer' : 'autumn'
  if (hemisphere === 'north') return north
  return north === 'winter' ? 'summer' : north === 'summer' ? 'winter' : north === 'spring' ? 'autumn' : 'spring'
}

const key = (month: number, day: number): number => month * 100 + day

function within(day: CalendarDay, from: { year?: number; month: number; day: number }, to: { year?: number; month: number; day: number }): boolean {
  if (from.year !== undefined && to.year !== undefined) {
    const at = day.year * 10000 + key(day.month, day.day)
    return at >= from.year * 10000 + key(from.month, from.day) && at <= to.year * 10000 + key(to.month, to.day)
  }
  const at = key(day.month, day.day)
  const start = key(from.month, from.day)
  const end = key(to.month, to.day)
  return start <= end ? at >= start && at <= end : at >= start || at <= end
}

function matches(token: Parsed, day: CalendarDay, calendar: Calendar): boolean {
  switch (token.kind) {
    case 'weekday': return day.weekday === token.weekday
    case 'month': return day.month === token.month
    case 'date': return day.month === token.month && day.day === token.day && (token.year === undefined || day.year === token.year)
    case 'span': return within(day, token.from, token.to)
    case 'dom': return token.day === 'last' ? day.day === daysIn(day.year, day.month) : day.day === token.day
    case 'nth': return day.weekday === token.weekday && (token.n === 'last' ? day.day + 7 > daysIn(day.year, day.month) : Math.ceil(day.day / 7) === token.n)
    case 'season': return seasonOf(day, calendar.hemisphere) === token.season
    case 'holiday': return holidaysOn(calendar, day).some(holiday => holiday.id === token.id)
  }
}

/** Whether a list of day tokens holds on a day; tokens that say nothing sensible count as not matching. An empty list holds on every day. */
export function dayMatches(tokens: readonly string[], day: CalendarDay, calendar: Calendar = NO_CALENDAR): boolean {
  const parsed = tokens.flatMap((raw) => { const found = parseDayToken(raw); return 'problem' in found ? [] : [found] })
  const wanted = parsed.filter(entry => !entry.negated)
  const unwanted = parsed.filter(entry => entry.negated)
  return (wanted.length === 0 || wanted.some(entry => matches(entry.token, day, calendar))) && !unwanted.some(entry => matches(entry.token, day, calendar))
}

/** The holidays that fall on a day. A holiday is told by days that are no holidays themselves, so that none can lead back to itself. */
export function holidaysOn(calendar: Calendar, day: CalendarDay): Holiday[] {
  return calendar.holidays.filter(holiday => holiday.on.length > 0 && dayMatches(holiday.on, day, { ...calendar, holidays: [] }))
}

const CALENDAR_KEY = 'calendar'

/** The calendar a story was started with, from its metadata; none when the world has none. */
export function readCalendar(metadata: { getValue(key: string): unknown }): Calendar {
  const stored = metadata.getValue(CALENDAR_KEY)
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return NO_CALENDAR
  const { hemisphere, holidays } = stored as { hemisphere?: unknown; holidays?: unknown }
  return {
    hemisphere: hemisphere === 'south' ? 'south' : 'north',
    holidays: Array.isArray(holidays) ? holidays.flatMap((entry): Holiday[] => {
      const { id, name, on } = (entry ?? {}) as { id?: unknown; name?: unknown; on?: unknown }
      return typeof id === 'string' && typeof name === 'string' && Array.isArray(on) ? [{ id, name, on: on.filter((token): token is string => typeof token === 'string') }] : []
    }) : [],
  }
}

export const writeCalendar = (metadata: { setValue(key: string, value: never): void }, calendar: Calendar): void => { metadata.setValue(CALENDAR_KEY, calendar as never) }
