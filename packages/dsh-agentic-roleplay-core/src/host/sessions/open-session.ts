import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, type RoleplayState } from '@dsh-agentic-roleplay/state'
import type { OpenedSession } from '../../shared/sessions.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_OPENING, readOpening, rebuildChat, repointTimeline } from '../agent/history.ts'
import { readTimeline, writeTimeline } from '../timeline/file.ts'
import { SessionArchivedError, SessionNotFoundError } from './errors.ts'
import { readStatus } from './status.ts'
import { sessionFolder } from '@dsh-agentic-roleplay/state'
import { chatSessionId as chatSessionOf } from '../../shared/chat.ts'

export interface OpenSessionDeps {
  state: Pick<RoleplayState, 'openSession'>
  agent: Pick<AgentSessions, 'ensure' | 'has'>
  sessionsDir: () => string
  /** Puts a log in the place of the chat's own; without it a chat that exists is never made again. */
  replaceChat?: (id: string, title: string, events: readonly SessionEvent[]) => Promise<void>
}

/** Make sure a session has its DSH chat, so that it can be opened. */
export async function openSession(deps: OpenSessionDeps, id: string, options: { rebuild?: boolean } = {}): Promise<OpenedSession> {
  if (!isSessionId(id) || !existsSync(sessionDatabase(deps.sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  if (readStatus(sessionFolder(deps.sessionsDir(), id)).archivedAt !== undefined) throw new SessionArchivedError(`the session "${id}" is put away: bring it back first`)
  const { name } = deps.state.openSession(deps.sessionsDir(), id).metadata.get()
  const folder = sessionFolder(deps.sessionsDir(), id)
  const present = await deps.agent.has(id)
  const again = !present || (options.rebuild === true && deps.replaceChat !== undefined)
  const timeline = again ? readTimeline(folder) : undefined
  // A session from before openings were kept has none to restore; it still has its turns, which are worth more in the chat than its first words.
  const opening = again ? readOpening(folder) ?? (timeline!.nodes.length > 0 ? [{ type: 'narration' as const, text: DEFAULT_OPENING }] : undefined) : undefined
  if (opening === undefined || timeline === undefined) return { id, chatSessionId: await deps.agent.ensure(id, name) }
  // The chat is not on this installation, or the session was brought here from another and the chat is out of date: it is made again
  // from what the folder keeps.
  const rebuilt = rebuildChat(opening, timeline)
  const chatSessionId = present ? chatSessionOf(id) : await deps.agent.ensure(id, name, opening, rebuilt.events)
  if (present) await deps.replaceChat!(id, name, rebuilt.events)
  writeTimeline(folder, repointTimeline(timeline, rebuilt.seqs))
  return { id, chatSessionId }
}
