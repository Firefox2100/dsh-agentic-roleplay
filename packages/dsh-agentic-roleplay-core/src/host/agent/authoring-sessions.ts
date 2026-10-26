import { randomUUID } from 'node:crypto'
import { languageOf, translator } from 'dsh-roleplay-model'
import { join } from 'node:path'
import { authoringChatSessionId } from '../../shared/authoring-chat.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import { storeAuthoringOpening } from './opening.ts'

export const AUTHORING_PROJECT_TITLE = 'World Authoring'
export const AUTHORING_AGENT_PRESET = 'world-authoring'

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
    const chatTitle = title ?? authoringTitle(worldName, language)
    this.languages.set(worldId, language)
    const services = this.services()
    const projectPath = join(this.roleplayRoot(), 'worlds')
    const project = await services.registry.create(projectPath, AUTHORING_PROJECT_TITLE)
    const sessionId = authoringChatSessionId(worldId)
    const existed = project.sessionIds.includes(sessionId)
    const stored = !existed && await isStored(services.persistence, sessionId)
    if (!existed && !stored) {
      if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of an authoring chat')
      await storeAuthoringOpening(services.persistence, { id: sessionId, cwd: project.path, agentPreset: AUTHORING_AGENT_PRESET }, this.prompts.text('world/welcome', this.languages.get(worldId), { world: worldName }))
    }
    return await ensureAgentChat(services, {
      projectPath,
      projectTitle: AUTHORING_PROJECT_TITLE,
      sessionId,
      agentPreset: AUTHORING_AGENT_PRESET,
      title: chatTitle,
      renameExisting: true,
    }, project)
  }

  /** Sends a message into a chat as if the person had written it. */
  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
