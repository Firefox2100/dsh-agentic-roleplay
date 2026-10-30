import { randomUUID } from 'node:crypto'
import { languageOf, translator } from 'dsh-roleplay-model'
import { authoringChatSessionId } from '../../shared/authoring-chat.ts'
import type { AgentServices } from './agent-sessions.ts'
import { ensureAuthoringChat, type AuthoringKind } from './ensure-authoring-chat.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'

export const AUTHORING_PROJECT_TITLE = 'World Authoring'
export const AUTHORING_AGENT_PRESET = 'world-authoring'
const KIND: AuthoringKind = { folder: 'worlds', projectTitle: AUTHORING_PROJECT_TITLE, agentPreset: AUTHORING_AGENT_PRESET, welcome: 'world/welcome' }

/** The title of a world's authoring chat, in the language of the person who opened it. */
export function authoringTitle(worldName: string, language?: string): string {
  const tr = translator(languageOf(language))
  return tr('Authoring {name}', { name: worldName })
}

/** Creates or reopens the dedicated authoring chat of an authored world, and speaks in it for the person when asked to. */
export class AuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
    private readonly languages: AuthoringLanguages,
  ) {}

  async ensure(worldId: string, worldName: string, title?: string, language?: string): Promise<string> {
    return await ensureAuthoringChat(this.services(), this.roleplayRoot(), this.prompts, this.languages, KIND, {
      chatId: authoringChatSessionId(worldId), languageKey: worldId, title: title ?? authoringTitle(worldName, language), language, welcome: { world: worldName }, renameExisting: true,
    })
  }

  /** Sends a message into a chat as if the person had written it. */
  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
