import { join } from 'node:path'
import type { RoleplayState } from '@dsh-agentic-roleplay/state'
import type { SessionSummary, SessionsPayload } from '../../shared/sessions.ts'
import { sessionFolder } from '@dsh-agentic-roleplay/state'
import { chatSessionId } from '../agent/agent-sessions.ts'
import { readStatus } from './status.ts'

export interface ListSessionsDeps {
  state: Pick<RoleplayState, 'listSessions'>
  sessionsDir: () => string
}

/** The sessions on disk, the most recently played first; a session never played counts from its creation. */
export function listSessions(deps: ListSessionsDeps): SessionsPayload {
  const directory = deps.sessionsDir()
  const { sessions, problems } = deps.state.listSessions(directory)
  const archived = (id: string): { archivedAt?: string } => {
    try {
      return readStatus(sessionFolder(directory, id))
    } catch (error) {
      problems.push({ id, message: error instanceof Error ? error.message : String(error) })
      return {}
    }
  }
  const summaries = sessions.map((session): SessionSummary => ({
    id: session.id,
    chatSessionId: chatSessionId(session.id),
    name: session.name,
    worldId: session.world.id,
    worldName: session.world.name,
    createdAt: session.createdAt,
    ...(session.lastPlayedAt === undefined ? {} : { lastPlayedAt: session.lastPlayedAt }),
    turns: session.turns,
    ...archived(session.id),
  }))
  const recency = (session: SessionSummary): string => session.lastPlayedAt ?? session.createdAt
  summaries.sort((a, b) => recency(b).localeCompare(recency(a)))
  return {
    directory,
    sessions: summaries,
    problems: problems.map(problem => ({ path: join(directory, problem.id), message: problem.message })),
  }
}
