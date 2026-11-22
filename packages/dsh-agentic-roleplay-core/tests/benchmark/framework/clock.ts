import type { Files } from '../language.ts'

/**
 * A world that follows the real clock has days that depend on the time of day it is played at, so a row cannot name fixed hours. A layer writes them relative to the moment the row starts:
 * `{in+N}` is the local time of day N minutes from then (`HH:MM`), `{at+N}` the local date and time (`YYYY-MM-DDTHH:MM`), `{utc+N}` the instant in UTC (`YYYY-MM-DDTHH:MM:SSZ`); N may be negative.
 */
const TOKEN = /\{(in|at|utc)([+-]\d+)\}/g

const two = (value: number): string => String(value).padStart(2, '0')

function render(kind: string, at: Date): string {
  const local = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`
  if (kind === 'in') return local.slice(11)
  if (kind === 'at') return local
  return `${at.toISOString().slice(0, 19)}Z`
}

/** The text with its clock tokens written out for the moment `now`. */
export function resolveClockText(text: string, now: number): string {
  return text.replace(TOKEN, (_, kind: string, minutes: string) => render(kind, new Date(now + Number(minutes) * 60_000)))
}

const resolveValue = (value: unknown, now: number): unknown => {
  if (typeof value === 'string') return resolveClockText(value, now)
  if (Array.isArray(value)) return value.map(entry => resolveValue(entry, now))
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, now)]))
  return value
}

/** The files of a world with every clock token written out; files without one are returned as they are. */
export function resolveClock(files: Files, now: number): Files {
  return new Map([...files].map(([path, value]) => [path, resolveValue(value, now)]))
}

/** Whether a world's files hold a clock token: its days depend on when it is played. */
export function followsClock(files: Files): boolean {
  return [...files.values()].some(value => TOKEN.test(JSON.stringify(value)) && ((TOKEN.lastIndex = 0), true))
}
