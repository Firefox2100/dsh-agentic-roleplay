import { describe, expect, it } from 'vitest'
import { DAY, HOUR, MINUTE, catchUpPlan, dayPart, describeDuration, describeInstant, inWindow, isTimeZone, localIso, nextTimeOfDay, parseInstant, parseTimeOfDay, zonedInstant } from '../../src/index.ts'

describe('time zones', () => {
  it('knows which names are zones', () => {
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(' UTC')).toBe(false)
  })

  it('reads the same instant differently in different zones', () => {
    const instant = Date.UTC(1912, 9, 4, 19, 30)
    expect(describeInstant(instant, 'UTC')).toBe('Friday 4 October 1912, 19:30')
    expect(describeInstant(instant, 'Asia/Shanghai')).toBe('Saturday 5 October 1912, 03:30')
    expect(localIso(instant, 'Asia/Shanghai')).toBe('1912-10-05T03:30:00')
  })

  it('goes from a wall clock to the instant, summer time included, and over a jump', () => {
    expect(zonedInstant({ year: 2026, month: 7, day: 1, hour: 12 }, 'Europe/London')).toBe(Date.UTC(2026, 6, 1, 11))
    expect(zonedInstant({ year: 2026, month: 1, day: 1, hour: 12 }, 'Europe/London')).toBe(Date.UTC(2026, 0, 1, 12))
    expect(zonedInstant({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, 'Europe/London')).toBe(Date.UTC(2026, 2, 29, 1, 30))
    expect(zonedInstant({ year: 2026, month: 10, day: 4, hour: 21 }, 'America/New_York')).toBe(Date.UTC(2026, 9, 5, 1))
  })
})

describe('writing and reading dates', () => {
  it('takes a local date and time in the zone given, a date alone as midnight, and an offset as written', () => {
    expect(parseInstant('1912-10-04T19:30', 'UTC')).toBe(Date.UTC(1912, 9, 4, 19, 30))
    expect(parseInstant('1912-10-04 19:30:15', 'UTC')).toBe(Date.UTC(1912, 9, 4, 19, 30, 15))
    expect(parseInstant('1912-10-04', 'UTC')).toBe(Date.UTC(1912, 9, 4))
    expect(parseInstant('1912-10-04T19:30', 'Asia/Shanghai')).toBe(Date.UTC(1912, 9, 4, 11, 30))
    expect(parseInstant('1912-10-04T19:30+01:00', 'Asia/Shanghai')).toBe(Date.UTC(1912, 9, 4, 18, 30))
    expect(parseInstant('1912-10-04T19:30Z', 'Asia/Shanghai')).toBe(Date.UTC(1912, 9, 4, 19, 30))
  })

  it('refuses what is not a date and time', () => {
    for (const bad of ['tomorrow', '1912-13-04', '1912-02-30', '1912-10-04T25:00', '1912-10-04T10:61', '']) expect(() => parseInstant(bad, 'UTC')).toThrow(RangeError)
  })

  it('names the part of the day', () => {
    expect([0, 4 * 60 + 59, 5 * 60, 11 * 60 + 59, 12 * 60, 16 * 60 + 59, 17 * 60, 21 * 60 + 59, 22 * 60].map(dayPart)).toEqual(['night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night'])
  })

  it('says how long in words, to what matters', () => {
    expect(describeDuration(45_000)).toBe('45 seconds')
    expect(describeDuration(1000)).toBe('1 second')
    expect(describeDuration(90 * MINUTE)).toBe('1 hour 30 minutes')
    expect(describeDuration(3 * HOUR + 12 * MINUTE + 40_000)).toBe('3 hours 12 minutes')
    expect(describeDuration(2 * DAY + 3 * HOUR + 5 * MINUTE)).toBe('2 days 3 hours')
    expect(describeDuration(2 * DAY)).toBe('2 days')
    expect(describeDuration(-5)).toBe('0 seconds')
  })
})

describe('skipping to a time of day', () => {
  const evening = Date.UTC(1912, 9, 4, 21, 40)

  it('reads HH:MM', () => {
    expect(parseTimeOfDay('07:30')).toBe(450)
    expect(parseTimeOfDay('7:05')).toBe(425)
    expect(parseTimeOfDay('24:00')).toBeUndefined()
    expect(parseTimeOfDay('7.30')).toBeUndefined()
  })

  it('is the next time the clock reads it: later today, or tomorrow when it has passed', () => {
    expect(nextTimeOfDay(evening, 'UTC', '23:00')).toBe(Date.UTC(1912, 9, 4, 23))
    expect(nextTimeOfDay(evening, 'UTC', '07:00')).toBe(Date.UTC(1912, 9, 5, 7))
    expect(nextTimeOfDay(evening, 'UTC', '21:40')).toBe(Date.UTC(1912, 9, 5, 21, 40))
  })

  it('is that time that many days later, which has to be in the future', () => {
    expect(nextTimeOfDay(evening, 'UTC', '07:00', 1)).toBe(Date.UTC(1912, 9, 5, 7))
    expect(nextTimeOfDay(evening, 'UTC', '07:00', 3)).toBe(Date.UTC(1912, 9, 7, 7))
    expect(nextTimeOfDay(evening, 'UTC', '23:00', 0)).toBe(Date.UTC(1912, 9, 4, 23))
    expect(() => nextTimeOfDay(evening, 'UTC', '07:00', 0)).toThrow(/not after now/)
  })

  it('counts days by the wall clock of the zone, over a change of summer time', () => {
    const before = Date.UTC(2026, 2, 28, 22)
    expect(nextTimeOfDay(before, 'Europe/London', '07:00', 1)).toBe(Date.UTC(2026, 2, 29, 6))
  })

  it('refuses a time that is not one', () => {
    expect(() => nextTimeOfDay(evening, 'UTC', 'morning')).toThrow(RangeError)
  })
})

describe('windows of the day', () => {
  it('are half open', () => {
    expect([8 * 60 - 1, 8 * 60, 16 * 60 + 59, 17 * 60].map(minute => inWindow(minute, 8 * 60, 17 * 60))).toEqual([false, true, true, false])
  })

  it('wrap past midnight, and equal ends hold nothing', () => {
    expect([21 * 60 + 59, 22 * 60, 0, 5 * 60 + 59, 6 * 60].map(minute => inWindow(minute, 22 * 60, 6 * 60))).toEqual([false, true, true, true, false])
    expect(inWindow(0, 600, 600)).toBe(false)
    expect(inWindow(600, 600, 600)).toBe(false)
  })

  it('refuse a minute that is not one', () => {
    expect(() => inWindow(1440, 0, 10)).toThrow(RangeError)
  })
})

describe('catching up after being away', () => {
  it('keeps the whole gap when it is short, in steps of about a minute', () => {
    const plan = catchUpPlan(0, 10 * MINUTE)
    expect(plan).toMatchObject({ from: 0, to: 10 * MINUTE, skipped: 0 })
    expect(plan.steps).toHaveLength(10)
    expect(plan.steps[0]).toEqual({ from: 0, to: MINUTE })
    expect(plan.steps.at(-1)?.to).toBe(10 * MINUTE)
  })

  it('keeps only the newest part of a long gap and says how much it left out', () => {
    const plan = catchUpPlan(0, 30 * HOUR, { maxMs: 6 * HOUR })
    expect(plan.from).toBe(24 * HOUR)
    expect(plan.skipped).toBe(24 * HOUR)
    expect(plan.steps).toHaveLength(360)
    expect(plan.steps.every((step, index) => index === 0 || step.from === plan.steps[index - 1]!.to)).toBe(true)
  })

  it('caps the steps, and does not run backwards', () => {
    expect(catchUpPlan(0, 6 * HOUR, { maxSteps: 12 }).steps).toHaveLength(12)
    expect(catchUpPlan(1000, 500)).toMatchObject({ from: 1000, to: 1000, steps: [] })
    expect(() => catchUpPlan(0, 1, { maxSteps: 0 })).toThrow(RangeError)
  })
})
