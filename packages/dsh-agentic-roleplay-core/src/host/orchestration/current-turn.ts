import type { Agent } from '@deepseek-ai/dsh-agent'

/** What the agent service exposes of DSH's `turnBoundary` projection. */
interface TurnBoundaries {
  turnBoundaryOf(session: Agent['session']): { lastTurn: number } | undefined
}

/** The last turn the session started. */
export function currentTurn(agent: Agent): number {
  // DSH folds the turn boundaries in its own projection, so the answer is read instead of walked out of the log.
  // A profile (or a test double) without it keeps the answer only in the log.
  const last = lastProjectedTurn(agent)
  if (last !== undefined) return last
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start') return event.data.turn
  }
  return 0
}

function lastProjectedTurn(agent: Agent): number | undefined {
  try {
    const boundaries = agent.ctx?.get('agents') as TurnBoundaries | undefined
    return boundaries?.turnBoundaryOf(agent.session)?.lastTurn
  } catch { return undefined }
}
