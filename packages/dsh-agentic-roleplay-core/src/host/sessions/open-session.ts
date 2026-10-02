import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase } from 'dsh-roleplay-state'
import type { OpenedSession } from '../../shared/sessions.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { SessionNotFoundError } from './errors.ts'

export interface OpenSessionDeps {
  agent: Pick<AgentSessions, 'ensure'>
  sessionsDir: () => string
}

/** Make sure a session has its DSH chat, so that it can be opened. */
export async function openSession(deps: OpenSessionDeps, id: string): Promise<OpenedSession> {
  if (!isSessionId(id) || !existsSync(sessionDatabase(deps.sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  return { id, chatSessionId: await deps.agent.ensure(id) }
}
