import { createSessionStore, DAY, HOUR, MINUTE } from '@dsh-agentic-roleplay/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { ClockError, beginTurn, endRound, readTime, skipTime, type ClockSettings } from '../../../src/host/clock/story-clock.ts'

const wall = Date.UTC(2026, 6, 1, 9, 17, 42)
const simulated: ClockSettings = { mode: 'simulated', timeZone: 'UTC', roundSeconds: 30, maxSkipDays: 30 }
const real: ClockSettings = { ...simulated, mode: 'real' }
const evening = Date.UTC(1912, 9, 4, 21, 40)

let session: ReturnType<typeof createSessionStore>

beforeEach(() => { session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } }) })

const startAt = (now: number, mode: 'simulated' | 'real' = 'simulated'): void => { session.clock.start(mode, now) }

describe('a session with no clock yet', () => {
  it('starts one at the minute it is when the story is simulated, and at the instant it is when it follows the wall clock', () => {
    expect(readTime(session, simulated, 1, wall)).toEqual({ mode: 'simulated', now: Date.UTC(2026, 6, 1, 9, 17), zone: 'UTC' })
    const other = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    expect(readTime(other, real, 1, wall)).toEqual({ mode: 'real', now: wall, zone: 'UTC' })
  })

  it('reads in UTC when the settings name no zone, and in the zone they name otherwise', () => {
    startAt(evening)
    expect(readTime(session, { ...simulated, timeZone: '' }, 1, wall).zone).toBe('UTC')
    expect(readTime(session, { ...simulated, timeZone: 'Asia/Shanghai' }, 1, wall).zone).toBe('Asia/Shanghai')
  })
})

describe('simulated time', () => {
  beforeEach(() => { startAt(evening) })

  it('does not move with the wall clock or between turns', () => {
    expect(beginTurn(session, simulated, 1, wall)).toEqual({ time: { mode: 'simulated', now: evening, zone: 'UTC' } })
    expect(beginTurn(session, simulated, 2, wall + 10 * DAY).time.now).toBe(evening)
  })

  it('passes by what the game master says a round took, or by the default', () => {
    expect(endRound(session, simulated, 1, 1, wall, 120)).toEqual({ from: evening, to: evening + 2 * MINUTE, zone: 'UTC' })
    expect(endRound(session, simulated, 1, 2, wall)).toEqual({ from: evening + 2 * MINUTE, to: evening + 2.5 * MINUTE, zone: 'UTC' })
    expect(session.clock.get()?.now).toBe(evening + 2.5 * MINUTE)
  })

  it('takes at least as long as the journey the player\'s character made, whatever was said', () => {
    expect(endRound(session, simulated, 1, 1, wall, 10, 300).to).toBe(evening + 5 * MINUTE)
    expect(endRound(session, simulated, 1, 2, wall, 600, 300).to).toBe(evening + 15 * MINUTE)
    expect(endRound(session, simulated, 1, 3, wall, undefined, 300).to).toBe(evening + 20 * MINUTE)
    expect(endRound(session, simulated, 1, 4, wall, undefined, 5).to).toBe(evening + 20 * MINUTE + 30_000)
  })

  it('may take no time at all, and still marks where the round was', () => {
    endRound(session, { ...simulated, roundSeconds: 0 }, 3, 1, wall)
    expect(session.clock.at(3, 1)).toBe(evening)
  })

  it('dates what happened in a round by when it began', () => {
    endRound(session, simulated, 1, 1, wall, 60)
    endRound(session, simulated, 1, 2, wall, 60)
    expect([session.clock.at(1, 1), session.clock.at(1, 2)]).toEqual([evening, evening + MINUTE])
  })
})

describe('skipping time', () => {
  beforeEach(() => { startAt(evening) })

  it('goes by minutes, or to the next time the clock reads what is asked, and keeps the reason', () => {
    expect(skipTime(session, simulated, 1, 0, wall, { byMinutes: 90, reason: 'they wait' })).toEqual({ from: evening, to: evening + 90 * MINUTE, zone: 'UTC', reason: 'they wait' })
    expect(skipTime(session, simulated, 1, 1, wall, { untilTime: '07:00', reason: 'they sleep' }).to).toBe(Date.UTC(1912, 9, 5, 7))
    expect(skipTime(session, simulated, 2, 0, wall, { untilTime: '12:00', daysLater: 3, reason: 'a journey' }).to).toBe(Date.UTC(1912, 9, 8, 12))
    expect(session.clock.log({ kind: 'skip' }).map(step => [step.turn, step.round, step.reason])).toEqual([[1, 0, 'they wait'], [1, 1, 'they sleep'], [2, 0, 'a journey']])
  })

  it('counts the wall clock of the zone the story is read in', () => {
    expect(skipTime(session, { ...simulated, timeZone: 'Asia/Shanghai' }, 1, 0, wall, { untilTime: '07:00', reason: 'sleep' }).to).toBe(Date.UTC(1912, 9, 4, 23))
  })

  it('refuses what is not a skip, with the reason', () => {
    const refused = (request: Parameters<typeof skipTime>[5], config = simulated): string => { try { skipTime(session, config, 1, 0, wall, request); return 'allowed' } catch (error) { expect(error).toBeInstanceOf(ClockError); return (error as Error).message } }
    expect(refused({ byMinutes: 0, reason: 'x' })).toMatch(/at least 1/)
    expect(refused({ byMinutes: 1.5, reason: 'x' })).toMatch(/whole number/)
    expect(refused({ byMinutes: 10, reason: '  ' })).toMatch(/say what happens/)
    expect(refused({ untilTime: 'morning', reason: 'x' })).toMatch(/not a time of day/)
    expect(refused({ untilTime: '21:00', daysLater: 0, reason: 'x' })).toMatch(/not after now/)
    expect(refused({ byMinutes: 40 * 24 * 60, reason: 'x' })).toMatch(/more than the 30 days this chat allows/)
    expect(session.clock.log({ kind: 'skip' })).toEqual([])
  })
})

describe('time that follows the wall clock', () => {
  beforeEach(() => { startAt(wall - 3 * HOUR, 'real') })

  it('cannot be skipped', () => {
    expect(() => skipTime(session, real, 1, 0, wall, { byMinutes: 10, reason: 'x' })).toThrow(/follows the wall clock/)
    expect(session.clock.log({ kind: 'skip' })).toEqual([])
  })

  it('is the wall clock at the start of a turn, and says how long the player was away', () => {
    expect(beginTurn(session, real, 1, wall)).toEqual({ time: { mode: 'real', now: wall, zone: 'UTC' }, away: 3 * HOUR })
    expect(beginTurn(session, real, 2, wall)).toEqual({ time: { mode: 'real', now: wall, zone: 'UTC' } })
  })

  it('takes a round as long as it really took', () => {
    beginTurn(session, real, 1, wall)
    expect(endRound(session, real, 1, 1, wall + 45_000, 99, 9999)).toEqual({ from: wall, to: wall + 45_000, zone: 'UTC' })
    expect(session.clock.at(1, 1)).toBe(wall)
  })

  it('never goes back when the wall clock does', () => {
    expect(beginTurn(session, real, 1, wall - 10 * HOUR).time.now).toBe(wall - 3 * HOUR)
    expect(endRound(session, real, 1, 1, wall - 10 * HOUR).to).toBe(wall - 3 * HOUR)
  })
})

describe('changing how time passes', () => {
  it('stays simulated when the settings ask for the real clock: a story with its own dates cannot follow it', () => {
    startAt(evening)
    expect(readTime(session, real, 4, wall)).toEqual({ mode: 'simulated', now: evening, zone: 'UTC' })
    expect(beginTurn(session, real, 4, wall)).toEqual({ time: { mode: 'simulated', now: evening, zone: 'UTC' } })
    expect(session.clock.log({ kind: 'resync' })).toEqual([])
  })

  it('is detached from the real clock where it stands when the settings stop following it, and goes on by the story from there', () => {
    startAt(wall - 3 * HOUR, 'real')
    expect(readTime(session, simulated, 5, wall)).toEqual({ mode: 'simulated', now: wall, zone: 'UTC' })
    expect(session.clock.log({ kind: 'resync' })).toEqual([expect.objectContaining({ turn: 5, from: wall - 3 * HOUR, to: wall })])
    expect(endRound(session, simulated, 5, 1, wall + 99 * DAY, 60).to).toBe(wall + MINUTE)
  })

  it('does not run back when detached with the wall clock behind it', () => {
    startAt(wall + HOUR, 'real')
    expect(readTime(session, simulated, 5, wall).now).toBe(wall + HOUR)
  })
})
