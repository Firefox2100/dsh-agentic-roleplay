import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import { SessionNotFoundError } from './errors.ts'
import { readStatus, writeStatus } from './status.ts'

export interface ArchiveSessionDeps {
  agent: Pick<AgentSessions, 'archive' | 'restore'>
  sessionsDir: () => string
  now?: () => Date
}

function folderOf(deps: ArchiveSessionDeps, id: string): string {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  return sessionFolder(directory, id)
}

/**
 * Put a session away: its chat is hidden and stopped, and the session stays in the list, marked as archived, with its story and
 * its turns as they were. Putting it away twice changes nothing.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export async function archiveSession(deps: ArchiveSessionDeps, id: string): Promise<void> {
  const folder = folderOf(deps, id)
  if (readStatus(folder).archivedAt !== undefined) return
  await deps.agent.archive(id)
  writeStatus(folder, { archivedAt: (deps.now?.() ?? new Date()).toISOString() })
}

/**
 * Bring an archived session back: its chat is shown again and it can be played on. It is only brought back here, so that what
 * stands in the chat and what the story holds are the ones it was put away with.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export async function restoreSession(deps: ArchiveSessionDeps, id: string): Promise<void> {
  const folder = folderOf(deps, id)
  if (readStatus(folder).archivedAt === undefined) return
  await deps.agent.restore(id)
  writeStatus(folder, {})
}
