/** Told to the window when a branch has its session, so that the player can be asked to name it; the branch feature listens. */
export const BRANCHED_EVENT = 'roleplay:branched'

/** The slice of the session service used to branch a chat: DSH makes the chat, the host gives it its session. */
export interface Branching {
  fork(options: { sessionId: string; atSeq: number; increaseTitle: boolean }): Promise<string>
}

/**
 * Branches a roleplay chat after the turn that ended at `atSeq`, and shows the new chat.
 * Resolved on use, so a client without the services fails at the click.
 */
export async function branchAt(scope: { get(name: string): unknown }, chat: string, atSeq: number): Promise<void> {
  const sessions = scope.get('sessions') as Branching | undefined
  const workspace = scope.get('uiWorkspace') as { openSession(sessionId: string): void } | undefined
  if (sessions === undefined || workspace === undefined) throw new Error('branching is not available in this client')
  const branch = await sessions.fork({ sessionId: chat, atSeq, increaseTitle: true })
  const response = await fetch('roleplay-api/sessions/branch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: branch, parent: chat, atSeq }) })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `the branch could not be made (${response.status})`)
  const page = (globalThis as { window?: { dispatchEvent(event: Event): void } }).window
  page?.dispatchEvent(new CustomEvent(BRANCHED_EVENT, { detail: { chat: branch } }))
  workspace.openSession(branch)
}
