import { randomUUID } from 'node:crypto'
import { presetChatSessionId } from '../../shared/preset-chat.ts'
import type { AgentServices } from './agent-sessions.ts'
import { ensureAuthoringChat, type AuthoringKind } from './ensure-authoring-chat.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'

export const PRESET_AUTHORING_PROJECT_TITLE = 'Preset Authoring'
export const PRESET_AUTHORING_PRESET = 'preset-authoring'

const KIND: AuthoringKind = { folder: 'presets', projectTitle: PRESET_AUTHORING_PROJECT_TITLE, agentPreset: PRESET_AUTHORING_PRESET, welcome: 'preset/welcome' }

/** Creates or reopens the dedicated authoring chat of a library preset, and speaks in it for the person when asked to. */
export class PresetAuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
    private readonly languages: AuthoringLanguages,
  ) {}

  async ensure(name: string, title: string, language?: string): Promise<string> {
    return await ensureAuthoringChat(this.services(), this.roleplayRoot(), this.prompts, this.languages, KIND, {
      chatId: presetChatSessionId(name), languageKey: `preset:${name}`, title: `Preset ${title}`, language, welcome: { preset: title }, renameExisting: true,
    })
  }

  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  }
}
