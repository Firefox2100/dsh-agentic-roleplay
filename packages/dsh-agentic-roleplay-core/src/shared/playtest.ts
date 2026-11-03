import type { Finding } from './checks.ts'
import type { StateChange } from './compare.ts'

export const MAX_PLAYTEST_TURNS = 10

export interface PlaytestRequest {
  worldId: string
  /** The playable character the test player takes; the world's first playable one when left out. */
  playerCharacterId?: string
  /** An alternate opening of the world, by its position; the world's own when left out. */
  opening?: number
  /** How many turns are played, 1 to {@link MAX_PLAYTEST_TURNS}. */
  turns: number
  /** The language the story is played in. */
  language?: string
}

/** What one played turn cost. */
export interface PlaytestTurn {
  turn: number
  /** What the test player said. */
  player: string
  seconds: number
  /** Where the player's character was after it. */
  place: string
}

/** What a bounded test play found out about a world. */
export interface PlaytestReport {
  world: string
  asked: number
  played: number
  seconds: number
  turns: PlaytestTurn[]
  places: { visited: string[]; unvisited: string[] }
  triggers: { fired: string[]; waiting: string[] }
  /** What the test play changed in the story, from its start to its end. */
  changes: StateChange[]
  /** What the world's own checks found, without a model. */
  findings: Finding[]
  /** Things the test play ran into: a turn that took very long, no suggestions, a turn that did not finish. */
  problems: string[]
}

export type PlaytestState = 'running' | 'done' | 'stopped' | 'failed'

/** Where a world's test play stands. */
export interface PlaytestStatus {
  state: PlaytestState
  world: string
  turns: number
  played: number
  /** What it is doing now, in a few words. */
  step: string
  startedAt: string
  report?: PlaytestReport
  error?: string
}
