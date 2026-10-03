import type { Agent } from '@deepseek-ai/dsh-agent'

/** The last turn the session started. */
export function currentTurn(agent: Agent): number {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start') return event.data.turn
  }
  return 0
}
