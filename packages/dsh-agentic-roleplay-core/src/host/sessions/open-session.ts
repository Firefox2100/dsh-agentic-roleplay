import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, type RoleplayState } from '@dsh-agentic-roleplay/state'
import type { OpenedSession } from '../../shared/sessions.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { SessionArchivedError, SessionNotFoundError } from './errors.ts'
import { readStatus } from './status.ts'
import { sessionFolder } from '@dsh-agentic-roleplay/state'

export interface OpenSessionDeps {
  state: Pick<RoleplayState, 'openSession'>
  agent: Pick<AgentSessions, 'ensure'>
  sessionsDir: () => string
}

/** Make sure a session has its DSH chat, so that it can be opened. */
export async function openSession(deps: OpenSessionDeps, id: string): Promise<OpenedSession> {
  if (!isSessionId(id) || !existsSync(sessionDatabase(deps.sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  if (readStatus(sessionFolder(deps.sessionsDir(), id)).archivedAt !== undefined) throw new SessionArchivedError(`the session "${id}" is put away: bring it back first`)
  const { name } = deps.state.openSession(deps.sessionsDir(), id).metadata.get()
  return { id, chatSessionId: await deps.agent.ensure(id, name) }
}
