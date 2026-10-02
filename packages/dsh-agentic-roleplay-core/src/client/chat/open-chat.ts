import type { Context } from '@deepseek-ai/cordis'

/** The slice of the web client's workspace service used to show a chat. */
interface UiWorkspaceLike {
  openSession(sessionId: string): void
}

/** Shows a DSH chat session in the main area, in place of the Role Play panel. */
export type OpenChat = (chatSessionId: string) => void

/** Resolves the workspace service on use, so a client without it fails at the click, not at load. */
export function createChatOpener(ctx: Context): OpenChat {
  return (chatSessionId) => {
    const workspace = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
    if (workspace === undefined) throw new Error('the chat is not available in this client')
    workspace.openSession(chatSessionId)
  }
}
