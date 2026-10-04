import { agendaView, catchUpRoutines, sceneAgenda, type AgendaView, type RoutineMove, type SceneAgenda } from './agenda.ts'
import { beginTurn, endRound, readTime, skipTime, zoneOf, type ClockSettings, type SkipRequest, type StoryTime } from './story-clock.ts'

type PassageSession = Parameters<typeof catchUpRoutines>[0] & Parameters<typeof beginTurn>[0]
type Wall = () => number

/** The start of a turn: the time, how long the player was away, and what the days of the characters make of it. */
export function startTurn(session: PassageSession, config: ClockSettings, turn: number, wall: number): { time: StoryTime; away?: number; agenda: SceneAgenda } {
  const started = beginTurn(session, config, turn, wall)
  const moved = catchUpRoutines(session, started.time.zone, started.time.now, turn, true)
  return { ...started, agenda: sceneAgenda(session, started.time.zone, started.time.now, moved) }
}

/** A round passes, and the characters outside the scene take up what their days have for the new time. */
export function passRound(session: PassageSession, config: ClockSettings, turn: number, round: number, wall: number, stated?: number, minimum?: number): { from: number; to: number; zone: string; moved: RoutineMove[] } {
  const span = endRound(session, config, turn, round, wall, stated, minimum)
  return { ...span, moved: catchUpRoutines(session, span.zone, span.to, turn, false) }
}

/** Time is skipped, and the characters outside the scene take up what their days have for the new time. */
export function skipAhead(session: PassageSession, config: ClockSettings, turn: number, round: number, wall: number, request: SkipRequest): { from: number; to: number; zone: string; reason: string; moved: RoutineMove[] } {
  const span = skipTime(session, config, turn, round, wall, request)
  return { ...span, moved: catchUpRoutines(session, span.zone, span.to, turn, true) }
}

/** What a character is told of its own agenda. */
export function agendaFor(session: PassageSession, config: ClockSettings, turn: number, wall: Wall, characterId: number): AgendaView {
  const time = readTime(session, config, turn, wall())
  return agendaView(session, characterId, zoneOf(config), time.now)
}
