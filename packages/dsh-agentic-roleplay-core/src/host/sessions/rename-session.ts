import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, type RoleplayState } from '@dsh-agentic-roleplay/state'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { InvalidStartError, SessionNotFoundError } from './errors.ts'
import { MAX_NAME_LENGTH } from './start-session.ts'

export interface RenameSessionDeps {
  state: Pick<RoleplayState, 'openSession'>
  agent: Pick<AgentSessions, 'rename'>
  sessionsDir: () => string
}

/**
 * Give a session a new name, and its chat the same one.
 * @throws {SessionNotFoundError} when the id names no session. @throws {InvalidStartError} when the name is blank or too long.
 */
export async function renameSession(deps: RenameSessionDeps, id: string, name: string): Promise<void> {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const trimmed = name.trim()
  if (trimmed === '') throw new InvalidStartError('the session needs a name')
  if (trimmed.length > MAX_NAME_LENGTH) throw new InvalidStartError(`the session's name is longer than ${MAX_NAME_LENGTH} characters`)
  deps.state.openSession(directory, id).metadata.setName(trimmed)
  await deps.agent.rename(id, trimmed)
}
