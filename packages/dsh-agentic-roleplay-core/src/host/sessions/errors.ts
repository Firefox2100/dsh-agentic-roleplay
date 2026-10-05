import type { WorldProblem } from '../../shared/worlds.ts'

export class WorldNotFoundError extends Error {}

/** The world cannot be played as it is; `problems` say what to fix. */
export class InvalidWorldError extends Error {
  constructor(message: string, readonly problems: readonly WorldProblem[]) {
    super(message)
  }
}

/** The request cannot be honoured for this world, such as a character that cannot be played. */
export class InvalidStartError extends Error {}

export class SessionNotFoundError extends Error {}

/** DSH's session services are not available, so no chat can be created or retired. */
export class AgentUnavailableError extends Error {}

/** The session is put away and cannot be played until it is brought back. */
export class SessionArchivedError extends Error {}
