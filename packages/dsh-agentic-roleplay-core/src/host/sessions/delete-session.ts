import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, type RoleplayState } from 'dsh-roleplay-state'
import { chatSessionId } from '../../shared/chat.ts'
import { SessionNotFoundError } from './errors.ts'

export interface DeleteSessionDeps {
  state: Pick<RoleplayState, 'deleteSession'>
  /** Removes the chat of the session from DSH's store, with everything it started; it stops what is running first. */
  purgeChat: (chat: string) => Promise<unknown>
  sessionsDir: () => string
}

/**
 * Delete a session for good: its chat and everything the chat started are removed from DSH's store, and then the session's folder
 * with its story, its turns and the states kept to go back to. When the chat cannot be removed completely the session is kept, so that
 * deleting it can be tried again.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export async function deleteSession(deps: DeleteSessionDeps, id: string): Promise<void> {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  await deps.purgeChat(chatSessionId(id))
  deps.state.deleteSession(directory, id)
}
