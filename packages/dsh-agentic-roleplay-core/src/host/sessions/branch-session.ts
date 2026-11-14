import { roleplaySessionOf } from '../../shared/chat.ts'
import { AgentUnavailableError, SessionNotFoundError } from './errors.ts'

/** What making a branch needs from the running deployment; looked up when the branch is made. */
export interface BranchDeps<A> {
  /** The timelines of the running deployment, undefined when no story is being hosted. */
  timelines: { adopt(chat: string, parent: string, atSeq: number, agent: A): Promise<unknown> } | undefined
  /** The live agent of a chat, undefined when that chat is not running. */
  agentOf(chat: string): A | undefined
  /** Removes a chat from DSH's own store: the copy the fork made belongs to nobody when the branch cannot be played. */
  discard(chat: string): Promise<unknown>
}

/**
 * Adopts the story of `parent` into the chat DSH forked for it.
 *
 * The fork already made a copy by the time this runs, so a branch that cannot be adopted would leave
 * a chat with no story behind: it cannot be opened as a story and nothing would ever adopt it. Such a
 * copy is discarded. An unavailable agent is the exception — the copy is intact and the branch can be
 * tried again — so it is left in place.
 *
 * @throws {SessionNotFoundError} when either chat is not a chat of a story.
 * @throws {AgentUnavailableError} when the orchestration or the chat of the branch is not running.
 */
export async function branchSession<A>(deps: BranchDeps<A>, chat: string, parent: string, atSeq: number): Promise<{ id: string }> {
  const id = roleplaySessionOf(chat)
  if (id === undefined || roleplaySessionOf(parent) === undefined) throw new SessionNotFoundError(`"${chat}" and "${parent}" are not both chats of stories`)
  const timelines = deps.timelines
  const forked = deps.agentOf(chat)
  if (timelines === undefined || forked === undefined) throw new AgentUnavailableError('the branch cannot be made: the orchestration or the chat of the branch is not running')
  try {
    await timelines.adopt(chat, parent, atSeq, forked)
  } catch (error) {
    // Discarding is best effort: the error the branch failed with is the one the caller needs to see.
    if (!(error instanceof AgentUnavailableError)) await deps.discard(chat).catch(() => undefined)
    throw error
  }
  return { id }
}
