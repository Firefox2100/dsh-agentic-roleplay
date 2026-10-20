import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { lorebookChatSessionId } from '../../shared/lorebook-chat.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import { storeAuthoringOpening } from './opening.ts'

export const LOREBOOK_AUTHORING_PROJECT_TITLE = 'Lorebook Authoring'
export const LOREBOOK_AUTHORING_PRESET = 'lorebook-authoring'

/** Creates or reopens the dedicated authoring chat of a library lorebook, and speaks in it for the person when asked to. */
export class LorebookAuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
    private readonly languages: AuthoringLanguages,
  ) {}

  async ensure(name: string, title: string, language?: string): Promise<string> {
    this.languages.set(`lorebook:${name}`, language)
    const services = this.services()
    const projectPath = join(this.roleplayRoot(), 'lorebooks')
    const project = await services.registry.create(projectPath, LOREBOOK_AUTHORING_PROJECT_TITLE)
    const sessionId = lorebookChatSessionId(name)
    const stored = !project.sessionIds.includes(sessionId) && await isStored(services.persistence, sessionId)
    if (!project.sessionIds.includes(sessionId) && !stored) {
      if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of an authoring chat')
      await storeAuthoringOpening(services.persistence, { id: sessionId, cwd: project.path, agentPreset: LOREBOOK_AUTHORING_PRESET }, this.prompts.text('lorebook/welcome', this.languages.get(`lorebook:${name}`), { lorebook: title }))
    }
    return await ensureAgentChat(services, { projectPath, projectTitle: LOREBOOK_AUTHORING_PROJECT_TITLE, sessionId, agentPreset: LOREBOOK_AUTHORING_PRESET, title: `Lorebook ${title}`, renameExisting: true }, project)
  }

  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
