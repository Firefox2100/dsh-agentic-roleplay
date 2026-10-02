import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, type RoleplayState } from 'dsh-roleplay-state'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { SessionNotFoundError } from './errors.ts'

export interface DeleteSessionDeps {
  state: Pick<RoleplayState, 'deleteSession'>
  agent: Pick<AgentSessions, 'retire'>
  sessionsDir: () => string
}

/**
 * Remove a session's folder with everything in it, after its DSH chat is hidden
 * and stopped. The chat's own log stays in DSH's session store.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export async function deleteSession(deps: DeleteSessionDeps, id: string): Promise<void> {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  await deps.agent.retire(id)
  deps.state.deleteSession(directory, id)
}
