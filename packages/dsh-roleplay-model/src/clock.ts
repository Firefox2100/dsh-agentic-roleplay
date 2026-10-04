/**
 * How the story's time passes: `simulated` moves only when the story does (the game master says how
 * long things take and may skip ahead), `real` follows the wall clock.
 */
export const CLOCK_MODES = ['simulated', 'real'] as const
export type ClockMode = (typeof CLOCK_MODES)[number]

/** The story's clock: the instant it is in the story, in milliseconds since the Unix epoch (UTC). */
export interface ClockState {
  mode: ClockMode
  now: number
}

/** Why the story's time moved. */
export const TIME_CHANGE_KINDS = ['start', 'elapsed', 'real', 'skip', 'resync'] as const
export type TimeChangeKind = (typeof TIME_CHANGE_KINDS)[number]

/** One step of the story's time. `round` is 0 for what happens outside a round. */
export interface TimeChange {
  id: number
  turn: number
  round: number
  kind: TimeChangeKind
  from: number
  to: number
  reason: string
}

export interface TimeChangeFilter {
  turn?: number
  round?: number
  fromTurn?: number
  toTurn?: number
  kind?: TimeChangeKind
}
