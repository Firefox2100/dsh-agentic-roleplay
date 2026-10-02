import type { Context } from '@deepseek-ai/cordis'
import { AgentUnavailableError } from '../sessions/errors.ts'

/** Title of the DSH project that groups every roleplay chat. */
export const PROJECT_TITLE = 'Roleplay'

/** The agent preset roleplay chats run under; it is declared by the bundle. */
export const AGENT_PRESET = 'roleplay'

/** The slice of DSH's session controller used to create a chat. */
export interface SessionControllerLike {
  create(request: { workspaceId: string; sessionId: string; agentPreset: string }): Promise<{ sessionId: string }>
}

/** The slice of DSH's workspace registry used to group and hide chats. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string }>
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
}

export interface AgentServices {
  controller: SessionControllerLike
  registry: WorkspaceRegistryLike
}

/**
 * The DSH chat of a roleplay session is addressed by a name derived from the
 * roleplay session's id, so the two never need a stored link and creating the
 * chat twice finds the one that exists.
 */
export function chatSessionId(sessionId: string): string {
  return `session-${sessionId}`
}

/** Looks the services up on first use: profiles without the web app do not have them. */
export function agentServicesOf(ctx: Context): () => AgentServices {
  return () => {
    const controller = ctx.get('sessionController') as SessionControllerLike | undefined
    const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    if (controller === undefined || registry === undefined) {
      throw new AgentUnavailableError('this DSH profile has no session services, so a roleplay chat cannot be opened')
    }
    return { controller, registry }
  }
}

/**
 * Gives roleplay sessions a DSH chat. All chats share one project whose folder
 * is the roleplay root, because DSH groups a session under a project only when
 * the session's working folder is the project's folder.
 */
export class AgentSessions {
  constructor(
    private readonly services: () => AgentServices,
    private readonly projectPath: () => string,
  ) {}

  /** Create the chat of a roleplay session unless it exists; returns its DSH session id. */
  async ensure(sessionId: string): Promise<string> {
    const { controller, registry } = this.services()
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const { sessionId: chat } = await controller.create({ workspaceId: project.id, sessionId: chatSessionId(sessionId), agentPreset: AGENT_PRESET })
    return chat
  }

  /** Hide the chat and stop its work; a chat that was never created is nothing to retire. */
  async retire(sessionId: string): Promise<void> {
    try {
      await this.services().registry.archiveSession(chatSessionId(sessionId), { stopActivity: true })
    } catch (error) {
      if (!(error instanceof Error && error.name === 'WorkspaceUnknownSessionError')) throw error
    }
  }
}
