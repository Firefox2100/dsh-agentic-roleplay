import { doctorChatSessionId } from '../../shared/doctor-chat.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AgentServices } from './agent-sessions.ts'
import { ensureAuthoringChat, type AuthoringKind } from './ensure-authoring-chat.ts'
import { DOCTOR_OPENING_SOURCE } from './opening.ts'

export const DOCTOR_PROJECT_TITLE = 'Session Doctor'
export const DOCTOR_AGENT_PRESET = 'session-doctor'
const KIND: AuthoringKind = { folder: 'sessions', projectTitle: DOCTOR_PROJECT_TITLE, agentPreset: DOCTOR_AGENT_PRESET, welcome: 'doctor/welcome', openingSource: DOCTOR_OPENING_SOURCE }

/** Creates or reopens the chat in which a bystander reads one session's records and proposes fixes. */
export class DoctorSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
  ) {}

  async ensure(session: { id: string; name: string }, title: string, language: string): Promise<string> {
    return await ensureAuthoringChat(this.services(), this.roleplayRoot(), this.prompts, undefined, KIND, {
      chatId: doctorChatSessionId(session.id), title, language, welcome: { session: session.name }, renameExisting: false,
    })
  }
}
