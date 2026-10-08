import { join } from 'node:path'
import { authoringChatSessionId } from '../../shared/authoring-chat.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import { storeAuthoringOpening } from './opening.ts'

export const AUTHORING_PROJECT_TITLE = 'World Authoring'
export const AUTHORING_AGENT_PRESET = 'world-authoring'

/** Creates or reopens the dedicated authoring chat of an authored world. */
export class AuthoringSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly roleplayRoot: () => string,
  ) {}

  async ensure(worldId: string, worldName: string, title = `Authoring ${worldName}`): Promise<string> {
    const services = this.services()
    const projectPath = join(this.roleplayRoot(), 'worlds')
    const project = await services.registry.create(projectPath, AUTHORING_PROJECT_TITLE)
    const sessionId = authoringChatSessionId(worldId)
    const existed = project.sessionIds.includes(sessionId)
    const stored = !existed && await isStored(services.persistence, sessionId)
    if (!existed && !stored) {
      if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of an authoring chat')
      await storeAuthoringOpening(services.persistence, { id: sessionId, cwd: project.path, agentPreset: AUTHORING_AGENT_PRESET }, worldName)
    }
    return await ensureAgentChat(services, {
      projectPath,
      projectTitle: AUTHORING_PROJECT_TITLE,
      sessionId,
      agentPreset: AUTHORING_AGENT_PRESET,
      title,
      renameExisting: true,
    }, project)
  }
}
