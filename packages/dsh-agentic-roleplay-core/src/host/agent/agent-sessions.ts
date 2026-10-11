import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
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
  /** Says something in a chat as the person would; it is queued behind what the chat is doing. */
  prompt(request: { requestId: string; sessionId: string; mode: 'queue'; content: readonly { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<unknown>
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

export interface AgentChatRequest {
  projectPath: string
  projectTitle: string
  sessionId: string
  agentPreset: string
  title: string
  renameExisting?: boolean
}

async function isStored(persistence: SessionPersistenceLike | undefined, sessionId: string): Promise<boolean> {
  return persistence?.stat !== undefined && await persistence.stat(SessionId(sessionId)) !== undefined
}

/** Create or adopt one named preset chat and only name it on first creation. */
export async function ensureAgentChat(
  services: AgentServices,
  request: AgentChatRequest,
  knownProject?: { id: string; path: string; sessionIds: readonly string[] },
): Promise<string> {
  const project = knownProject ?? await services.registry.create(request.projectPath, request.projectTitle)
  const existed = project.sessionIds.includes(request.sessionId)
  const { sessionId } = await services.controller.create({ workspaceId: project.id, sessionId: request.sessionId, agentPreset: request.agentPreset })
  if (!existed || request.renameExisting === true) await services.controller.rename({ sessionId, title: request.title })
  return sessionId
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
    const services = this.services()
    const { registry, persistence } = services
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const wanted = chatSessionId(sessionId)
    const existed = project.sessionIds.includes(wanted)
    const stored = opening !== undefined && !existed && await isStored(persistence, wanted)
    if (opening !== undefined && !existed && !stored) {
      if (persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store a chat with an opening message')
      await storeOpening(persistence, { id: wanted, cwd: project.path, agentPreset: AGENT_PRESET }, opening)
    }
    return await ensureAgentChat(services, { projectPath: project.path, projectTitle: PROJECT_TITLE, sessionId: wanted, agentPreset: AGENT_PRESET, title }, project)
  }

  /** Says something in the chat of a session as the player would; it is queued behind what the chat is doing. The chat must exist (`ensure`). */
  async send(sessionId: string, text: string): Promise<void> {
    await this.services().controller.prompt({ requestId: randomUUID(), sessionId: chatSessionId(sessionId), mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
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

export { chatSessionId, isStored }
