import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { presetChatSessionId } from '../../shared/preset-chat.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import { storeAuthoringOpening } from './opening.ts'

export const PRESET_AUTHORING_PROJECT_TITLE = 'Preset Authoring'
export const PRESET_AUTHORING_PRESET = 'preset-authoring'

/** Creates or reopens the dedicated authoring chat of a library preset, and speaks in it for the person when asked to. */
export class PresetAuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
    private readonly languages: AuthoringLanguages,
  ) {}

  async ensure(name: string, title: string, language?: string): Promise<string> {
    this.languages.set(`preset:${name}`, language)
    const services = this.services()
    const projectPath = join(this.roleplayRoot(), 'presets')
    const project = await services.registry.create(projectPath, PRESET_AUTHORING_PROJECT_TITLE)
    const sessionId = presetChatSessionId(name)
    const stored = !project.sessionIds.includes(sessionId) && await isStored(services.persistence, sessionId)
    if (!project.sessionIds.includes(sessionId) && !stored) {
      if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of an authoring chat')
      await storeAuthoringOpening(services.persistence, { id: sessionId, cwd: project.path, agentPreset: PRESET_AUTHORING_PRESET }, this.prompts.text('preset/welcome', this.languages.get(`preset:${name}`), { preset: title }))
    }
    return await ensureAgentChat(services, { projectPath, projectTitle: PRESET_AUTHORING_PROJECT_TITLE, sessionId, agentPreset: PRESET_AUTHORING_PRESET, title: `Preset ${title}`, renameExisting: true }, project)
  }

  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
