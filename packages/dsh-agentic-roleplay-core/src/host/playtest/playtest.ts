import type { Session } from '@dsh-agentic-roleplay/state'
import type { Finding } from '../../shared/checks.ts'
import { MAX_PLAYTEST_TURNS, type PlaytestReport, type PlaytestRequest, type PlaytestStatus, type PlaytestTurn } from '../../shared/playtest.ts'
import type { Note } from '../../shared/notes.ts'
import type { StartedSession, StartSessionRequest } from '../../shared/sessions.ts'
import type { TimelineView } from '../../shared/timeline.ts'
import type { TurnTrace } from '../../shared/trace.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { compareStates, type StateSide } from '../timeline/compare.ts'

/** The test player's words when the story offered no suggestion to take. */
const FALLBACK_MOVES = {
  en: ['I look around and take stock of where I am.', 'I speak to the nearest person.', 'I go somewhere else.'],
  zh: ['我环顾四周，看看自己身处何地。', '我和离我最近的人说话。', '我去别的地方看看。'],
}
const movesIn = (language: string | undefined): readonly string[] => (language?.toLowerCase().startsWith('zh') === true ? FALLBACK_MOVES.zh : FALLBACK_MOVES.en)
const POLL_MS = 1000
const SUGGESTION_WAIT_MS = 90_000
/** A turn that takes this many times the median is named as slow. */
const SLOW_FACTOR = 3

/** The most refused calls a report lists. */
const MAX_REFUSED = 12
/** The most missing look-ups a report lists. */
const MAX_MISSING = 20

function refusals(traces: readonly TurnTrace[]): PlaytestReport['refused'] {
  return traces.flatMap(trace => (trace.calls ?? []).filter(call => call.failed).map(call => ({ turn: trace.turn, tool: call.tool, note: call.note }))).slice(0, MAX_REFUSED)
}

function lacks(traces: readonly TurnTrace[]): PlaytestReport['missing'] {
  const seen = new Set<string>()
  return traces.flatMap(trace => (trace.missing ?? []).map(entry => ({ turn: trace.turn, ...entry }))).filter(entry => {
    const key = `${entry.character}\n${entry.tool}\n${entry.about.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_MISSING)
}

export interface PlaytestDeps {
  start(request: StartSessionRequest): Promise<StartedSession>
  /** The id of the first character of the world a player can play, when it has one. */
  firstPlayer(worldId: string): Promise<string | undefined>
  send(session: string, text: string): Promise<void>
  timeline(session: string): TimelineView
  playing(chat: string): boolean
  notes(session: string): Note[]
  story(session: string): Session
  /** What each played turn's trace recorded; kept with the story, so it is read before the story is removed. */
  trace(session: string): TurnTrace[]
  halt(chat: string): Promise<void>
  remove(session: string): Promise<void>
  /** The world's checks that need no model. */
  check(worldId: string): Promise<Finding[]>
  now(): number
  sleep(ms: number): Promise<void>
  /** The longest one turn may take before the test gives up on it. */
  turnTimeoutMs(): number
}

interface Running {
  status: PlaytestStatus
  abort: AbortController
  done: Promise<void>
}

const sideOf = (label: string, story: Session): StateSide => ({ label, turns: story.metadata.get().turns, now: ((now) => (now === undefined ? undefined : new Date(now).toISOString()))(story.clock.get()?.now), view: story.records() })

const median = (values: readonly number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]! }

/**
 * A bounded test play of a world: a story is started from it like any other, a few turns are played in which the test player takes what the story itself suggests,
 * and the report says where it went, what it set off, how long each turn took and what the world's own checks find. The story is removed afterwards, and the world is only read.
 */
export class Playtests {
  private readonly runs = new Map<string, Running>()

  constructor(private readonly deps: PlaytestDeps) {}

  status(world: string): PlaytestStatus | undefined {
    return this.runs.get(world)?.status
  }

  /**
   * @throws {InvalidEditProblems} when the request cannot be used or a test play of this world is running.
   */
  start(request: PlaytestRequest): PlaytestStatus {
    if (!Number.isInteger(request.turns) || request.turns < 1 || request.turns > MAX_PLAYTEST_TURNS) throw new InvalidEditProblems([`turns must be a whole number from 1 to ${MAX_PLAYTEST_TURNS}`])
    if (this.runs.get(request.worldId)?.status.state === 'running') throw new InvalidEditProblems(['a test play of this world is running: stop it first'])
    if ([...this.runs.values()].some(run => run.status.state === 'running')) throw new InvalidEditProblems(['another test play is running: models are used for one at a time'])
    const status: PlaytestStatus = { state: 'running', world: request.worldId, turns: request.turns, played: 0, step: 'starting the story', startedAt: new Date(this.deps.now()).toISOString() }
    const abort = new AbortController()
    const run: Running = { status, abort, done: Promise.resolve() }
    run.done = this.play(request, run).catch((error: unknown) => {
      status.state = abort.signal.aborted ? 'stopped' : 'failed'
      status.error = error instanceof Error ? error.message : String(error)
    })
    this.runs.set(request.worldId, run)
    return status
  }

  /** Has the test play end after the turn it is in; the story is removed. */
  async stop(world: string): Promise<void> {
    const run = this.runs.get(world)
    if (run === undefined || run.status.state !== 'running') return
    run.abort.abort()
    await run.done
  }

  /** Resolves when the test play of a world is over (for tests and shutdown). */
  async finished(world: string): Promise<void> {
    await this.runs.get(world)?.done
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.runs].filter(([, run]) => run.status.state === 'running').map(([world]) => this.stop(world)))
  }

  private async play(request: PlaytestRequest, run: Running): Promise<void> {
    const { deps } = this
    const { status, abort } = run
    const began = deps.now()
    const player = request.playerCharacterId ?? await deps.firstPlayer(request.worldId)
    if (player === undefined) throw new InvalidEditProblems(['the world has no character a player can play'])
    const started = await deps.start({
      worldId: request.worldId, name: `Playtest ${new Date(began).toISOString().slice(0, 16).replace('T', ' ')}`, playerCharacterId: player,
      ...request.opening === undefined ? {} : { opening: request.opening },
      ...request.startingTime === undefined ? {} : { startingTime: request.startingTime },
      settings: { ...(request.language === undefined ? {} : { prompts: { language: request.language } }), images: { mode: 'off' }, suggestions: { count: 3 } },
    })
    const session = started.id
    const problems: string[] = []
    const turns: PlaytestTurn[] = []
    try {
      const story = deps.story(session)
      const first = sideOf('the start', story)
      const visited = new Set<string>()
      const placeOf = (): string => story.records().characters.find(character => character.controlled_by === 'the player')?.location ?? ''
      if (placeOf() !== '') visited.add(placeOf())
      for (let turn = 1; turn <= request.turns && !abort.signal.aborted; turn += 1) {
        status.step = `turn ${turn} of ${request.turns}: choosing the player's move`
        const move = await this.moveFor(session, turn, problems, abort.signal, request.language)
        if (abort.signal.aborted) break
        status.step = `turn ${turn} of ${request.turns}: playing`
        const sentAt = deps.now()
        await deps.send(session, move)
        const finished = await this.waitForTurn(session, started.chatSessionId, turn, abort.signal)
        if (!finished) { problems.push(abort.signal.aborted ? `turn ${turn} was stopped` : `turn ${turn} did not finish within ${Math.round(deps.turnTimeoutMs() / 60000)} minutes`); break }
        const place = placeOf()
        if (place !== '') visited.add(place)
        turns.push({ turn, player: move, seconds: Math.round((deps.now() - sentAt) / 1000), place })
        status.played = turn
      }
      status.step = 'looking at what happened'
      const last = sideOf('the end', story)
      const typical = median(turns.map(turn => turn.seconds))
      for (const turn of turns) if (turns.length >= 3 && typical > 0 && turn.seconds > typical * SLOW_FACTOR) problems.push(`turn ${turn.turn} took ${turn.seconds} s, ${Math.round(turn.seconds / typical)} times the usual ${typical} s`)
      const places = story.locations.list().map(place => ({ key: place.sourceId ?? String(place.id), name: place.name }))
      const triggers = story.triggers.list().filter(trigger => trigger.origin === 'world')
      const report: PlaytestReport = {
        world: started.worldName, asked: request.turns, played: turns.length, seconds: Math.round((deps.now() - began) / 1000), turns,
        places: { visited: places.filter(place => visited.has(place.key)).map(place => place.name), unvisited: places.filter(place => !visited.has(place.key)).map(place => place.name) },
        triggers: { fired: triggers.filter(trigger => trigger.fireCount > 0).map(trigger => trigger.name), waiting: triggers.filter(trigger => trigger.status === 'dormant' && trigger.fireCount === 0).map(trigger => trigger.name) },
        changes: compareStates(first, last).changes, findings: await deps.check(request.worldId), refused: refusals(deps.trace(session)), missing: lacks(deps.trace(session)), problems,
      }
      status.report = report
      status.state = abort.signal.aborted ? 'stopped' : 'done'
      status.step = ''
    } finally {
      await deps.halt(started.chatSessionId).catch((): void => undefined)
      await deps.remove(session).catch((error: unknown) => { status.error = `the test story could not be removed (${error instanceof Error ? error.message : String(error)}): delete the session "${started.name}" yourself` })
    }
  }

  /** What the test player says: one of the story's own suggestions, in turn, or a plain move when none came. */
  private async moveFor(session: string, turn: number, problems: string[], signal: AbortSignal, language?: string): Promise<string> {
    const moves = movesIn(language)
    if (turn === 1) return moves[0]!
    const until = this.deps.now() + SUGGESTION_WAIT_MS
    while (this.deps.now() < until && !signal.aborted) {
      const lines = this.deps.notes(session).find(note => note.kind === 'suggestions')?.lines ?? []
      if (lines.length > 0) return lines[(turn - 2) % lines.length]!
      await this.deps.sleep(POLL_MS)
    }
    if (!signal.aborted) problems.push(`no suggestion came before turn ${turn}, so the test player took a plain move`)
    return moves[(turn - 1) % moves.length]!
  }

  private async waitForTurn(session: string, chat: string, turn: number, signal: AbortSignal): Promise<boolean> {
    const until = this.deps.now() + this.deps.turnTimeoutMs()
    while (this.deps.now() < until && !signal.aborted) {
      const view = this.deps.timeline(session)
      const last = view.path.at(-1)
      if (view.path.length >= turn && last?.output !== undefined && !this.deps.playing(chat)) return true
      await this.deps.sleep(POLL_MS)
    }
    return false
  }
}
