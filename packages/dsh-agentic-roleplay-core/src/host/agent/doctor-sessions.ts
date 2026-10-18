import { join } from 'node:path'
import { doctorChatSessionId } from '../../shared/doctor-chat.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import { storeDoctorOpening } from './opening.ts'

export const DOCTOR_PROJECT_TITLE = 'Session Doctor'
export const DOCTOR_AGENT_PRESET = 'session-doctor'

/** Creates or reopens the chat in which a bystander reads one session's records and proposes fixes. */
export class DoctorSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
    private readonly prompts: PromptLibrary,
  ) {}

  async ensure(session: { id: string; name: string }, title: string, language: string): Promise<string> {
    const services = this.services()
    const projectPath = join(this.roleplayRoot(), 'sessions')
    const project = await services.registry.create(projectPath, DOCTOR_PROJECT_TITLE)
    const sessionId = doctorChatSessionId(session.id)
    if (!project.sessionIds.includes(sessionId) && !await isStored(services.persistence, sessionId)) {
      if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of a session doctor chat')
      await storeDoctorOpening(services.persistence, { id: sessionId, cwd: project.path, agentPreset: DOCTOR_AGENT_PRESET }, this.prompts.text('doctor/welcome', language, { session: session.name }))
    }
    return await ensureAgentChat(services, { projectPath, projectTitle: DOCTOR_PROJECT_TITLE, sessionId, agentPreset: DOCTOR_AGENT_PRESET, title }, project)
  }
}
