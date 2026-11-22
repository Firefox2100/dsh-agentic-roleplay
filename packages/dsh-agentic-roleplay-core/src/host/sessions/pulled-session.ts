import { sessionFolder } from '@dsh-agentic-roleplay/state'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { readStatus } from './status.ts'

export interface PulledSessionDeps {
  agent: Pick<AgentSessions, 'archive' | 'restore'>
  sessionsDir: () => string
  /** Makes the chat again from the files the folder now holds; refuses a session that is put away. */
  rebuild: (id: string) => Promise<unknown>
}

/**
 * A session pulled from another device brings its own status. A session that is put away there is put away here too (its chat is
 * hidden and stopped, and none is made); one that was brought back is shown again and its chat made from the files.
 * @returns what the session's status is after the pull.
 */
export async function matchPulledSession(deps: PulledSessionDeps, id: string): Promise<'archived' | 'active'> {
  if (readStatus(sessionFolder(deps.sessionsDir(), id)).archivedAt !== undefined) {
    await deps.agent.archive(id)
    return 'archived'
  }
  await deps.agent.restore(id)
  await deps.rebuild(id)
  return 'active'
}
