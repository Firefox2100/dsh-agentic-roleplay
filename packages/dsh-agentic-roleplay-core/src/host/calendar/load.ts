import { join } from 'node:path'
import { MONTH_NAMES, SEASONS, dayTokenProblems, type Calendar } from '@dsh-agentic-roleplay/state'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const CALENDAR_FILE_NAME = 'calendar.json'
export const MAX_HOLIDAYS = 60
const HOLIDAY_ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,59}$/u

/**
 * Read `calendar.json`: the holidays of the world and the hemisphere its seasons follow (docs/world-format.md). A holiday is told by days (`12-25`,
 * `09-21..09-22`, `nth:mon:1`, `season:winter`, a month, a weekday); it cannot name another holiday.
 */
export function parseCalendarFile(text: string): ParseResult<Calendar> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const hemisphere = reader.oneOf('hemisphere', ['north', 'south'] as const, 'north')
  const seen = new Set<string>()
  const holidays = reader.objects('holidays').flatMap((entry) => {
    const id = entry.string('id', { required: true })
    const name = entry.string('name', { required: true })
    const on = entry.strings('on')
    if (id !== undefined && !HOLIDAY_ID.test(id)) entry.fail('id', 'is made of letters, digits, "-" and "_" (at most 60)')
    if (id !== undefined && seen.has(id)) entry.fail('id', `"${id}" is used by another holiday`)
    if (id !== undefined) seen.add(id)
    if (on.length === 0) entry.fail('on', `names no day: write days such as "12-25", "09-21..09-22", "nth:mon:1" or a month (${MONTH_NAMES.join(', ')}); seasons are ${SEASONS.join(', ')}`)
    for (const problem of dayTokenProblems(on, 'on')) entry.fail('on', problem.replace(/^on: /, ''))
    return id === undefined || name === undefined ? [] : [{ id, name, on }]
  })
  if (holidays.length > MAX_HOLIDAYS) reader.fail('holidays', `a world has at most ${MAX_HOLIDAYS} holidays`)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { hemisphere, holidays } }
}

/** The calendar of a world: an optional `<world>/calendar.json`; a world without one has none. */
export async function loadCalendar(worldDir: string): Promise<{ calendar: Calendar; problems: WorldProblem[] }> {
  const result: { calendar: Calendar; problems: WorldProblem[] } = { calendar: { hemisphere: 'north', holidays: [] }, problems: [] }
  const file = join(worldDir, CALENDAR_FILE_NAME)
  try {
    result.calendar = (await readDocument(file, parseCalendarFile, result.problems)) ?? result.calendar
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}
