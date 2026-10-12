import { DAY, MINUTE, SECOND, clockTime, dayPart, describeInstant, localTime, nextTimeOfDay, type ClockMode, type Session } from '@dsh-agentic-roleplay/state'
import type { ChatSettings } from '../../shared/settings.ts'

export type ClockSettings = ChatSettings['clock']
type ClockSession = Pick<Session, 'clock' | 'transaction'>

/** What time it is in the story. */
export interface StoryTime {
  mode: ClockMode
  /** UTC milliseconds. */
  now: number
  /** The zone it is read in. */
  zone: string
}

/** How the game master asks for time to be skipped. */
export type SkipRequest =
  | { byMinutes: number; reason: string }
  | { untilTime: string; daysLater?: number; reason: string }

export class ClockError extends Error {}

/** A moment as it is told next to `now`: the clock when it is the same day, the date as well when it is not. */
export function describeWhen(instant: number, now: number, zone: string): string {
  const a = localTime(instant, zone)
  const b = localTime(now, zone)
  return a.year === b.year && a.month === b.month && a.day === b.day ? clockTime(instant, zone) : describeInstant(instant, zone)
}

/** The time in a sentence: the day and date, the clock, and the part of the day. */
export function describeTime(time: { now: number; zone: string }): string {
  return `${describeInstant(time.now, time.zone)} (${dayPart(localTime(time.now, time.zone).minuteOfDay)})`
}

/** The time zone the story is read in. */
export const zoneOf = (config: ClockSettings): string => (config.timeZone === '' ? 'UTC' : config.timeZone)

/** The clock, started when a session has none yet, and detached from the real clock when the settings say so. The mode the story has is the one it keeps otherwise. */
function ensure(session: ClockSession, config: ClockSettings, turn: number, wall: number): { mode: ClockMode; now: number } {
  const current = session.clock.get()
  if (current === undefined) {
    session.clock.start(config.mode, config.mode === 'real' ? wall : Math.floor(wall / MINUTE) * MINUTE)
    return session.clock.get() ?? { mode: config.mode, now: wall }
  }
  // A story with its own dates cannot be made to follow the wall clock; only the other way round, which detaches it where it is.
  if (current.mode !== 'real' || config.mode !== 'simulated') return current
  session.clock.resync('simulated', Math.max(current.now, wall), turn, 'the story\'s time was detached from the real clock')
  return session.clock.get() ?? current
}

const timeOf = (state: { mode: ClockMode; now: number }, config: ClockSettings): StoryTime => ({ mode: state.mode, now: state.now, zone: zoneOf(config) })

/** What time it is, without letting any pass. */
export function readTime(session: ClockSession, config: ClockSettings, turn: number, wall: number): StoryTime {
  return session.transaction(() => timeOf(ensure(session, config, turn, wall), config))
}

/**
 * The start of a turn. Following the wall clock, the time since the last turn passed outside the story:
 * `away` says how long.
 */
export function beginTurn(session: ClockSession, config: ClockSettings, turn: number, wall: number): { time: StoryTime; away?: number } {
  return session.transaction(() => {
    const state = ensure(session, config, turn, wall)
    if (state.mode === 'real' && wall > state.now) {
      session.clock.advance({ to: wall, turn, round: 0, kind: 'real', reason: 'between turns' })
      return { time: timeOf({ mode: 'real', now: wall }, config), away: wall - state.now }
    }
    return { time: timeOf(state, config) }
  })
}

/**
 * A round passes. Simulated, it takes what the game master said (or the default), and at least as long as the
 * journey the player's character made (`minimum`); following the wall clock, it takes as long as it took.
 */
export function endRound(session: ClockSession, config: ClockSettings, turn: number, round: number, wall: number, stated?: number, minimum?: number): { from: number; to: number; zone: string } {
  return session.transaction(() => {
    const state = ensure(session, config, turn, wall)
    if (state.mode === 'real') {
      const to = Math.max(state.now, wall)
      session.clock.advance({ to, turn, round, kind: 'real' })
      return { from: state.now, to, zone: zoneOf(config) }
    }
    const took = Math.max(stated ?? config.roundSeconds, minimum ?? 0) * SECOND
    session.clock.advance({ to: state.now + took, turn, round, kind: 'elapsed' })
    return { from: state.now, to: state.now + took, zone: zoneOf(config) }
  })
}

/**
 * Skip ahead in the story's own time.
 * @throws {ClockError} when time follows the wall clock, the request is not one, or it asks for more than the chat allows.
 */
export function skipTime(session: ClockSession, config: ClockSettings, turn: number, round: number, wall: number, request: SkipRequest): { from: number; to: number; zone: string; reason: string } {
  return session.transaction(() => {
    const state = ensure(session, config, turn, wall)
    if (state.mode === 'real') throw new ClockError('the story\'s time follows the wall clock, so it cannot be skipped')
    const zone = zoneOf(config)
    const reason = request.reason.trim()
    if (reason === '') throw new ClockError('say what happens in the time that passes (reason)')
    let to: number
    if ('byMinutes' in request) {
      if (!Number.isInteger(request.byMinutes) || request.byMinutes < 1) throw new ClockError('by_minutes must be a whole number of minutes, at least 1')
      to = state.now + request.byMinutes * MINUTE
    } else {
      try {
        to = nextTimeOfDay(state.now, zone, request.untilTime, request.daysLater)
      } catch (error) {
        throw new ClockError(error instanceof RangeError ? error.message : String(error))
      }
    }
    if (to - state.now > config.maxSkipDays * DAY) {
      throw new ClockError(`that is ${Math.round((to - state.now) / DAY)} days from now (${describeInstant(state.now, zone)}), more than the ${config.maxSkipDays} days this chat allows in one skip`)
    }
    session.clock.advance({ to, turn, round, kind: 'skip', reason })
    return { from: state.now, to, zone, reason }
  })
}
