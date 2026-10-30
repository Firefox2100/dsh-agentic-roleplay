import { randomUUID } from 'node:crypto'
import { lorebookChatSessionId } from '../../shared/lorebook-chat.ts'
import type { AgentServices } from './agent-sessions.ts'
import { ensureAuthoringChat, type AuthoringKind } from './ensure-authoring-chat.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'

export const LOREBOOK_AUTHORING_PROJECT_TITLE = 'Lorebook Authoring'
export const LOREBOOK_AUTHORING_PRESET = 'lorebook-authoring'
const KIND: AuthoringKind = { folder: 'lorebooks', projectTitle: LOREBOOK_AUTHORING_PROJECT_TITLE, agentPreset: LOREBOOK_AUTHORING_PRESET, welcome: 'lorebook/welcome' }

/** Creates or reopens the dedicated authoring chat of a library lorebook, and speaks in it for the person when asked to. */
export class LorebookAuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
    private readonly languages: AuthoringLanguages,
  ) {}

  async ensure(name: string, title: string, language?: string): Promise<string> {
    return await ensureAuthoringChat(this.services(), this.roleplayRoot(), this.prompts, this.languages, KIND, {
      chatId: lorebookChatSessionId(name), languageKey: `lorebook:${name}`, title: `Lorebook ${title}`, language, welcome: { lorebook: title }, renameExisting: true,
    })
  }

  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
