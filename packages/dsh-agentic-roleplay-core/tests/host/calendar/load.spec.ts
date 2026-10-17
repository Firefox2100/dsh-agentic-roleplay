import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadCalendar, parseCalendarFile } from '../../../src/host/calendar/load.ts'
import { parseCharacterFile } from '../../../src/host/characters/character-file.ts'
import { routineProblems } from '../../../src/host/sessions/populate.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'calendar-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const issues = (text: string): string[] => { const result = parseCalendarFile(text); return result.ok ? [] : result.issues.map(issue => `${issue.path}: ${issue.message}`) }

describe('the calendar of a world', () => {
  it('has holidays told by days, and a hemisphere for its seasons', () => {
    const result = parseCalendarFile(JSON.stringify({ hemisphere: 'south', holidays: [{ id: 'festival', name: 'Founder\'s Festival', on: ['09-21..09-22'] }, { id: 'market', name: 'Market', on: ['nth:sat:1', '!dec'] }] }))
    expect(result).toEqual({ ok: true, value: { hemisphere: 'south', holidays: [{ id: 'festival', name: 'Founder\'s Festival', on: ['09-21..09-22'] }, { id: 'market', name: 'Market', on: ['nth:sat:1', '!dec'] }] } })
    expect(parseCalendarFile('{}')).toEqual({ ok: true, value: { hemisphere: 'north', holidays: [] } })
  })

  it('tells every problem with where it is', () => {
    expect(issues(JSON.stringify({ hemisphere: 'moon', holidays: [{ id: 'a b', name: 'X', on: ['someday'] }, { id: 'a', name: 'Y', on: [] }, { id: 'a', name: 'Z', on: ['holiday:a'] }, { name: 'No id', on: ['dec'] }] }))).toEqual(expect.arrayContaining([
      expect.stringContaining('hemisphere: must be one of: north, south'),
      expect.stringContaining('holidays[0].id: is made of letters'),
      expect.stringContaining('holidays[0].on: "someday"'),
      expect.stringContaining('holidays[1].on: names no day'),
      expect.stringContaining('holidays[2].id: "a" is used by another holiday'),
      expect.stringContaining('holidays[2].on: "holiday:a": a holiday cannot be named here'),
      expect.stringContaining('holidays[3].id: is required'),
    ]))
  })

  it('is read from the world folder, and a world without a file has none', async () => {
    expect(await loadCalendar(directory)).toEqual({ calendar: { hemisphere: 'north', holidays: [] }, problems: [] })
    await writeFile(join(directory, 'calendar.json'), JSON.stringify({ holidays: [{ id: 'f', name: 'F', on: ['dec'] }] }))
    expect((await loadCalendar(directory)).calendar.holidays).toHaveLength(1)
    await writeFile(join(directory, 'calendar.json'), '{ nope')
    expect((await loadCalendar(directory)).problems).toHaveLength(1)
  })
})

describe('the days in a routine beyond the days of the week', () => {
  const character = (on: unknown) => parseCharacterFile(JSON.stringify({ name: 'Clara', role: 'npc', routine: [{ from: '09:00', to: '17:00', activity: 'minds the shop', days: ['mon'], on }] }), 'clara')

  it('are read with the window, and refused when a day is not one', () => {
    const fine = character(['!season:winter', 'dec', 'holiday:festival'])
    expect(fine.ok && fine.value.routine?.[0]).toMatchObject({ days: ['mon'], on: ['!season:winter', 'dec', 'holiday:festival'] })
    const bad = character(['someday'])
    expect(!bad.ok && bad.issues.map(issue => issue.message)).toEqual([expect.stringContaining('"someday": not a day')])
  })

  it('name only holidays the world has, when the world is checked', () => {
    const parsed = character(['holiday:festival', '!holiday:harvest'])
    if (!parsed.ok) throw new Error('not read')
    expect(routineProblems([parsed.value], [], { hemisphere: 'north', holidays: [{ id: 'festival', name: 'F', on: ['dec'] }] })).toEqual(['clara: routine[0].on: "!holiday:harvest": the world names no holiday "harvest"'])
    expect(routineProblems([parsed.value], [], { hemisphere: 'north', holidays: [{ id: 'festival', name: 'F', on: ['dec'] }, { id: 'harvest', name: 'H', on: ['oct'] }] })).toEqual([])
  })
})
