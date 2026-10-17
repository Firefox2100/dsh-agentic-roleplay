import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_CALENDAR, agendaAt, dayMatches, dayTokenProblems, holidaysOn, occurrenceAt, parseDayToken, readCalendar, seasonOf, writeCalendar, type Calendar, type CalendarDay, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

/** A day, with the weekday worked out. */
const day = (date: string): CalendarDay => { const [year, month, of] = date.split('-').map(Number) as [number, number, number]; return { year, month, day: of, weekday: new Date(Date.UTC(year, month - 1, of)).getUTCDay() } }

const calendar: Calendar = {
  hemisphere: 'north',
  holidays: [
    { id: 'founders-festival', name: 'Founder\'s Festival', on: ['09-21..09-22'] },
    { id: 'market-day', name: 'Market day', on: ['nth:sat:1', '!dec'] },
    { id: 'empty', name: 'Nothing', on: [] },
  ],
}

describe('the days a thing applies on', () => {
  it('reads each kind of token, with a ! for a day it does not apply on, and says what is not one', () => {
    for (const token of ['mon', 'dec', '12-24', '1912-09-21', '12-20..01-05', '1912-09-21..1912-09-22', 'dom:1', 'dom:last', 'nth:mon:1', 'nth:fri:last', 'season:winter', 'holiday:x', '!dec', ' DEC ']) expect(parseDayToken(token), token).not.toHaveProperty('problem')
    for (const token of ['', 'monday', '13-01', '02-30', '1912-02-30', '12-20..1913-01-05', 'dom:32', 'dom:0', 'nth:mon:6', 'nth:xyz:1', 'season:monsoon', 'holiday:', 'a:b:c:d']) expect(parseDayToken(token), token).toHaveProperty('problem')
    expect(dayTokenProblems(['dec', 'zzz', 'holiday:fete'], 'w.on', new Set(['founders-festival']))).toEqual(['w.on: "zzz": not a day: use a weekday (`mon`), a month (`dec`), a date (`12-24`, `1912-09-21`), a stretch (`12-20..01-05`), `dom:1`, `nth:mon:1`, `season:winter` or `holiday:<id>`', 'w.on: "holiday:fete": the world names no holiday "fete"'])
    expect(dayTokenProblems(['holiday:any'], 'p', 'any')).toEqual([])
    expect(dayTokenProblems(['holiday:any'], 'p')).toEqual(['p: "holiday:any": a holiday cannot be named here'])
  })

  it('holds on the days it names: weekdays, months, a date every year or once, stretches that cross the new year', () => {
    expect(dayMatches(['fri'], day('1912-10-04'))).toBe(true)
    expect(dayMatches(['fri', 'sat'], day('1912-10-06'))).toBe(false)
    expect(dayMatches(['oct'], day('1912-10-04'))).toBe(true)
    expect(dayMatches(['12-24'], day('1912-12-24'))).toBe(true)
    expect(dayMatches(['12-24'], day('1913-12-24'))).toBe(true)
    expect(dayMatches(['1912-12-24'], day('1913-12-24'))).toBe(false)
    expect(dayMatches(['12-20..01-05'], day('1913-01-02'))).toBe(true)
    expect(dayMatches(['12-20..01-05'], day('1913-01-06'))).toBe(false)
    expect(dayMatches(['1912-09-21..1912-09-22'], day('1912-09-22'))).toBe(true)
    expect(dayMatches(['1912-09-21..1912-09-22'], day('1913-09-22'))).toBe(false)
  })

  it('holds on the day of the month, and on the first or last of a weekday of the month', () => {
    expect(dayMatches(['dom:1'], day('1912-10-01'))).toBe(true)
    expect(dayMatches(['dom:last'], day('1912-02-29'))).toBe(true)
    expect(dayMatches(['dom:last'], day('1913-02-28'))).toBe(true)
    expect(dayMatches(['dom:last'], day('1913-02-27'))).toBe(false)
    expect(dayMatches(['nth:mon:1'], day('1912-10-07'))).toBe(true)
    expect(dayMatches(['nth:mon:1'], day('1912-10-14'))).toBe(false)
    expect(dayMatches(['nth:fri:last'], day('1912-10-25'))).toBe(true)
    expect(dayMatches(['nth:fri:last'], day('1912-10-18'))).toBe(false)
  })

  it('has seasons that follow the hemisphere', () => {
    expect([1, 4, 7, 10].map(month => seasonOf({ month }))).toEqual(['winter', 'spring', 'summer', 'autumn'])
    expect([1, 4, 7, 10].map(month => seasonOf({ month }, 'south'))).toEqual(['summer', 'autumn', 'winter', 'spring'])
    expect(dayMatches(['season:winter'], day('1912-12-01'))).toBe(true)
    expect(dayMatches(['season:winter'], day('1912-12-01'), { ...calendar, hemisphere: 'south' })).toBe(false)
  })

  it('combines: a day applies when one that is wanted is today and none left out is', () => {
    expect(dayMatches(['!dec'], day('1912-10-04'))).toBe(true)
    expect(dayMatches(['!dec'], day('1912-12-04'))).toBe(false)
    expect(dayMatches(['sat', 'sun', '!season:winter'], day('1912-10-05'))).toBe(true)
    expect(dayMatches(['sat', 'sun', '!season:winter'], day('1912-12-07'))).toBe(false)
    expect(dayMatches([], day('1912-10-05'))).toBe(true)
  })

  it('knows the holidays of the world, which are told by days and never by other holidays', () => {
    expect(dayMatches(['holiday:founders-festival'], day('1912-09-21'), calendar)).toBe(true)
    expect(dayMatches(['holiday:founders-festival'], day('1912-09-23'), calendar)).toBe(false)
    expect(dayMatches(['!holiday:founders-festival'], day('1912-09-21'), calendar)).toBe(false)
    expect(dayMatches(['holiday:unknown'], day('1912-09-21'), calendar)).toBe(false)
    expect(dayMatches(['holiday:founders-festival'], day('1912-09-21'))).toBe(false)
    expect(holidaysOn(calendar, day('1912-09-21')).map(holiday => holiday.id)).toEqual(['founders-festival'])
    expect(holidaysOn(calendar, day('1912-10-05')).map(holiday => holiday.id)).toEqual(['market-day'])
    expect(holidaysOn(calendar, day('1912-12-07'))).toEqual([])
  })
})

describe('the calendar of a story', () => {
  let store: SessionStore
  beforeEach(() => { store = memoryStore() })
  afterEach(() => { store.close() })

  it('is none until the world gives one, and is kept with the story', () => {
    expect(readCalendar(store.metadata)).toEqual(NO_CALENDAR)
    writeCalendar(store.metadata, calendar)
    expect(readCalendar(store.metadata)).toEqual(calendar)
    store.metadata.setValue('calendar', { hemisphere: 'moon', holidays: [{ id: 3 }, { id: 'ok', name: 'Ok', on: ['dec', 7] }] })
    expect(readCalendar(store.metadata)).toEqual({ hemisphere: 'north', holidays: [{ id: 'ok', name: 'Ok', on: ['dec'] }] })
  })

  describe('in a routine', () => {
    const alice = () => store.characters.getBySourceId('alice')!.id
    const at = (date: string, hour: number): number => Date.UTC(...(date.split('-').map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))) as [number, number, number]), hour)
    beforeEach(() => {
      store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] }))
      writeCalendar(store.metadata, calendar)
      store.routines.replace(alice(), [
        { days: [], on: ['holiday:founders-festival'], start: 9 * 60, end: 23 * 60, activity: 'plays at the festival', interruptible: true },
        { days: [1, 2, 3, 4, 5], on: ['!season:winter'], start: 9 * 60, end: 17 * 60, activity: 'works', interruptible: true },
        { days: [], start: 0, end: 24 * 60 - 1, activity: 'is at home', interruptible: true },
      ])
    })

    it('applies on the days it is told to, besides the days of the week, and not on the days left out', () => {
      const windows = store.routines.list(alice())
      expect(windows[0]!.on).toEqual(['holiday:founders-festival'])
      const doing = (date: string, hour: number) => occurrenceAt(windows, at(date, hour), 'UTC', calendar)?.window.activity
      expect(doing('1912-09-21', 10)).toBe('plays at the festival')
      expect(doing('1912-09-23', 10)).toBe('works')
      expect(doing('1912-12-04', 10)).toBe('is at home')
      expect(doing('1912-10-05', 10)).toBe('is at home')
      expect(occurrenceAt(windows, at('1912-09-21', 10), 'UTC')?.window.activity).toBe('is at home')
    })

    it('reads the calendar from the story when asked for an agenda', () => {
      const agenda = (date: string) => agendaAt(store, alice(), at(date, 10), 'UTC', { horizon: 3_600_000 }).now?.window.activity
      expect(agenda('1912-09-21')).toBe('plays at the festival')
      expect(agenda('1912-09-23')).toBe('works')
    })

    it('is part of the window when it is read back', () => {
      store.routines.replace(alice(), [{ days: [0], on: ['dec', '12-25'], start: 60, end: 120, activity: 'x', interruptible: true }])
      expect(store.routines.list(alice())[0]).toMatchObject({ days: [0], on: ['dec', '12-25'] })
      store.routines.replace(alice(), [{ days: [], start: 60, end: 120, activity: 'x', interruptible: true }])
      expect(store.routines.list(alice())[0]!.on).toEqual([])
    })
  })
})
