/** Instants are UTC milliseconds; a time zone only decides how they read. */

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
    formatters.set(zone, formatter)
  }
  return formatter
}

/** Whether a name is a time zone this runtime knows (an IANA name such as `Europe/London`, or `UTC`). */
export function isTimeZone(zone: string): boolean {
  if (zone.trim() === '' || zone !== zone.trim()) return false
  try {
    formatterFor(zone)
    return true
  } catch {
    return false
  }
}

/** The time zone of this computer. */
export const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export interface LocalTime {
  year: number
  /** 1 to 12. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 for Sunday to 6 for Saturday. */
  weekday: number
  minuteOfDay: number
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/** What the wall clock of a zone reads at an instant. */
export function localTime(instant: number, zone: string): LocalTime {
  const parts = Object.fromEntries(formatterFor(zone).formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  const hour = Number(parts['hour'])
  const minute = Number(parts['minute'])
  return {
    year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']), hour, minute, second: Number(parts['second']),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts['weekday'])),
    minuteOfDay: hour * 60 + minute,
  }
}

function utcOf(fields: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }): number {
  const date = new Date(0)
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day)
  date.setUTCHours(fields.hour ?? 0, fields.minute ?? 0, fields.second ?? 0, 0)
  return date.getTime()
}

/** The instant at which the wall clock of a zone reads this; a time that does not exist (the clocks jumped over it) is moved on by the length of the jump. */
export function zonedInstant(fields: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, zone: string): number {
  const asUtc = utcOf(fields)
  const offsetAt = (instant: number): number => {
    const local = localTime(instant, zone)
    return utcOf(local) - Math.floor(instant / SECOND) * SECOND
  }
  const first = asUtc - offsetAt(asUtc)
  const second = asUtc - offsetAt(first)
  return second
}

const LOCAL = /^(-?\d{1,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * An instant from text: an ISO 8601 date and time with an offset or `Z` is taken as written; without one
 * it is the wall clock of `zone`. A date alone is that day at midnight.
 * @throws {RangeError} when it is not a date and time.
 */
export function parseInstant(text: string, zone: string): number {
  const trimmed = text.trim()
  const local = LOCAL.exec(trimmed)
  if (local !== null) {
    const [, year, month, day, hour, minute, second] = local
    const fields = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour ?? 0), minute: Number(minute ?? 0), second: Number(second ?? 0) }
    const check = new Date(utcOf(fields))
    if (check.getUTCMonth() !== fields.month - 1 || check.getUTCDate() !== fields.day || fields.hour > 23 || fields.minute > 59 || fields.second > 59) throw new RangeError(`"${text}" is not a date and time`)
    return zonedInstant(fields, zone)
  }
  if (/^-?\d{4,6}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const instant = Date.parse(trimmed.replace(' ', 'T'))
    if (!Number.isNaN(instant)) return instant
  }
  throw new RangeError(`"${text}" is not a date and time: write it as 1912-10-04T19:30 (or with an offset, 1912-10-04T19:30+01:00)`)
}

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

/** `Tuesday 4 October 1912, 21:40`, or `1912年10月4日 星期二 21:40`. */
export function describeInstant(instant: number, zone: string, language: 'en' | 'zh' = 'en'): string {
  const local = localTime(instant, zone)
  if (language === 'zh') return `${local.year}年${local.month}月${local.day}日 ${WEEKDAYS_ZH[local.weekday]} ${pad(local.hour)}:${pad(local.minute)}`
  return `${WEEKDAYS[local.weekday]} ${local.day} ${MONTHS[local.month - 1]} ${local.year}, ${pad(local.hour)}:${pad(local.minute)}`
}

/** `1912-10-04T21:40:00` as the wall clock of a zone reads, the form a file or a person can write back. */
export function localIso(instant: number, zone: string): string {
  const local = localTime(instant, zone)
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const DAY_PARTS = ['night', 'morning', 'afternoon', 'evening'] as const
export type DayPart = (typeof DAY_PARTS)[number]

/** Night is from 22:00 to 05:00, morning to 12:00, afternoon to 17:00, evening after. */
export function dayPart(minuteOfDay: number): DayPart {
  const hour = Math.floor(minuteOfDay / 60)
  return hour < 5 || hour >= 22 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
}

/** In words and rounded to what matters: `45 seconds`, `3 hours 12 minutes`, `2 days 3 hours`; or `45秒`, `3小时12分钟`, `2天3小时`. */
export function describeDuration(milliseconds: number, language: 'en' | 'zh' = 'en'): string {
  const total = Math.max(0, Math.round(milliseconds / SECOND))
  if (language === 'zh') {
    if (total < 60) return `${total}秒`
    const parts: string[] = []
    let left = total
    for (const [name, size] of [['天', 86_400], ['小时', 3600], ['分钟', 60]] as const) {
      const count = Math.floor(left / size)
      left -= count * size
      if (count > 0) parts.push(`${count}${name}`)
      if (parts.length === 2) break
    }
    return parts.join('')
  }
  if (total < 60) return `${total} second${total === 1 ? '' : 's'}`
  const units: [string, number][] = [['day', 86_400], ['hour', 3600], ['minute', 60]]
  const parts: string[] = []
  let left = total
  for (const [name, size] of units) {
    const count = Math.floor(left / size)
    left -= count * size
    if (count > 0) parts.push(`${count} ${name}${count === 1 ? '' : 's'}`)
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

/** The minute of the day for `HH:MM` (24-hour), or nothing when it is not one. */
export function parseTimeOfDay(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined
}

/**
 * The instant the wall clock of a zone next reads `HH:MM` after `now`; with `daysLater`, that time on the day
 * that many days after today (it must still be after `now`).
 * @throws {RangeError} when the time is not `HH:MM` or is not after `now`.
 */
export function nextTimeOfDay(now: number, zone: string, time: string, daysLater?: number): number {
  const minuteOfDay = parseTimeOfDay(time)
  if (minuteOfDay === undefined) throw new RangeError(`"${time}" is not a time of day: write it as 07:30 (24-hour)`)
  const today = localTime(now, zone)
  const at = (extraDays: number): number => {
    const day = new Date(utcOf({ year: today.year, month: today.month, day: today.day }) + extraDays * DAY)
    return zonedInstant({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 }, zone)
  }
  if (daysLater !== undefined) {
    const target = at(daysLater)
    if (target <= now) throw new RangeError(`${time} ${daysLater === 0 ? 'today' : `${daysLater} day${daysLater === 1 ? '' : 's'} later`} is not after now (${describeInstant(now, zone)})`)
    return target
  }
  const sameDay = at(0)
  return sameDay > now ? sameDay : at(1)
}

/** Whether a minute of the day is inside a window; `start` to `end` is half open and wraps past midnight, and equal ends make an empty window. */
export function inWindow(minuteOfDay: number, start: number, end: number): boolean {
  for (const value of [minuteOfDay, start, end]) if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new RangeError('a minute of the day is from 0 to 1439')
  return start <= end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end
}

/**
 * What to catch up on after being away: only the newest `maxMs` of the gap, in at most `maxSteps` equal
 * steps, so that a long absence costs a bounded amount of work.
 */
export function catchUpPlan(cursor: number, now: number, limits: { maxMs?: number; maxSteps?: number } = {}): { from: number; to: number; skipped: number; steps: { from: number; to: number }[] } {
  const maxMs = limits.maxMs ?? 6 * HOUR
  const maxSteps = limits.maxSteps ?? 360
  if (!Number.isInteger(maxMs) || maxMs <= 0 || !Number.isInteger(maxSteps) || maxSteps <= 0) throw new RangeError('the limits of a catch-up are positive whole numbers')
  const to = Math.max(cursor, now)
  const from = Math.max(cursor, to - maxMs)
  const span = to - from
  const count = Math.min(maxSteps, Math.ceil(span / MINUTE))
  return { from, to, skipped: from - cursor, steps: Array.from({ length: count }, (_, index) => ({ from: from + Math.floor(span * index / count), to: from + Math.floor(span * (index + 1) / count) })) }
}

/** `21:40`: the clock of a zone at an instant. */
export function clockTime(instant: number, zone: string): string {
  const local = localTime(instant, zone)
  return `${pad(local.hour)}:${pad(local.minute)}`
}

/** The local calendar day `days` after the one the instant falls on, as year, month and day. */
export function addLocalDays(instant: number, zone: string, days: number): { year: number; month: number; day: number; weekday: number } {
  const today = localTime(instant, zone)
  const moved = new Date(utcOf({ year: today.year, month: today.month, day: today.day }) + days * DAY)
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate(), weekday: moved.getUTCDay() }
}

/** `07:30` for a minute of the day. */
export const minuteText = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
