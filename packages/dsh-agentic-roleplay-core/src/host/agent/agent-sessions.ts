import type { Context } from '@deepseek-ai/cordis'
import { chatSessionId } from '../../shared/chat.ts'
import type { NarrationSegment } from '../../shared/narration.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import { storeOpening, type SessionPersistenceLike } from './opening.ts'

/** Title of the DSH project that groups every roleplay chat. */
export const PROJECT_TITLE = 'Roleplay'

/** The agent preset roleplay chats run under; it is declared by the bundle. */
export const AGENT_PRESET = 'roleplay'

/** The slice of DSH's session controller used to create a chat. */
export interface SessionControllerLike {
  create(request: { workspaceId: string; sessionId: string; agentPreset: string }): Promise<{ sessionId: string }>
  /** Pins the chat's title, so no title is made from the first message. */
  rename(request: { sessionId: string; title: string }): Promise<unknown>
}

/** The slice of DSH's workspace registry used to group and hide chats. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string; path: string; sessionIds: readonly string[] }>
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

export interface AgentServices {
  controller: SessionControllerLike
  registry: WorkspaceRegistryLike
  /** Needed only to start a chat with an opening message. */
  persistence?: SessionPersistenceLike
}

/** Looks the services up on first use: profiles without the web app do not have them. */
export function agentServicesOf(ctx: Context): () => AgentServices {
  return () => {
    const controller = ctx.get('sessionController') as SessionControllerLike | undefined
    const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    if (controller === undefined || registry === undefined) {
      throw new AgentUnavailableError('this DSH profile has no session services, so a roleplay chat cannot be opened')
    }
    const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
    return { controller, registry, ...(persistence === undefined ? {} : { persistence }) }
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

  /**
   * Create the chat of a roleplay session unless it exists; returns its DSH session id.
   * @param title - the name to give a chat that is new; one that exists keeps its own.
   * @param opening - what a chat that is new opens with: narration and lines of its characters, shown before the player says anything.
   * @throws {AgentUnavailableError} when there is an opening and no way to store it.
   */
  async ensure(sessionId: string, title: string, opening?: readonly NarrationSegment[]): Promise<string> {
    const { controller, registry, persistence } = this.services()
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const wanted = chatSessionId(sessionId)
    const existed = project.sessionIds.includes(wanted)
    if (opening !== undefined && !existed) {
      if (persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store a chat with an opening message')
      await storeOpening(persistence, { id: wanted, cwd: project.path, agentPreset: AGENT_PRESET }, opening)
    }
    const { sessionId: chat } = await controller.create({ workspaceId: project.id, sessionId: wanted, agentPreset: AGENT_PRESET })
    if (!existed) await controller.rename({ sessionId: chat, title })
    return chat
  }

  /** Give the chat of a session a new title. A chat that was never created has none to change. */
  async rename(sessionId: string, title: string): Promise<void> {
    const { controller, registry } = this.services()
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const chat = chatSessionId(sessionId)
    if (project.sessionIds.includes(chat)) await controller.rename({ sessionId: chat, title })
  }

  /** Put the chat away: hidden and stopped, and kept; a chat that was never created is nothing to put away. */
  async archive(sessionId: string): Promise<void> {
    await this.retire(sessionId)
  }

  /** Show a chat that was put away again. A chat that does not exist (it is made when the session is opened) is nothing to bring back. */
  async restore(sessionId: string): Promise<void> {
    try {
      await this.services().registry.unarchiveSession(chatSessionId(sessionId))
    } catch (error) {
      if (!(error instanceof Error && error.name === 'WorkspaceUnknownSessionError')) throw error
    }
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

export { chatSessionId }
