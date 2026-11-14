import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { CommandRefusedError, runCommandLine, type CommandOutcome } from '../commands/registry.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { chatSessionId } from '../../shared/chat.ts'
import type { NarrationSegment } from '../../shared/narration.ts'
import { AgentUnavailableError } from '../sessions/errors.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { storeInitialEvents, storeOpening, type SessionPersistenceLike } from './opening.ts'

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
export interface WorkspaceLike {
  id: string
  path: string
  sessionIds: readonly string[]
  /** Makes a stored chat part of the project; its stored working folder must be the project's. */
  attachSession(sessionId: string): Promise<void>
}

export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

export interface AgentServices {
  controller: SessionControllerLike
  registry: WorkspaceRegistryLike
  /** Needed only to start a chat with an opening message. */
  persistence?: SessionPersistenceLike
  /** Stops the chat's live agent and lets go of its log, so the log can be written again; a chat nobody has loaded here is not affected. */
  unload?: (chat: string) => Promise<void>
  /** Runs a line the way the input box does when the chat's agent knows the command it starts; nothing when it is no command of that chat (or the chat is not loaded). */
  command?: (chat: string, line: string) => Promise<CommandOutcome | undefined>
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

/**
 * Make sure one named preset chat belongs to its project, and only name it on first creation. DSH's `create` reuses a stored chat only while
 * it has no turn and mints another id otherwise, so a chat that exists is never created again: one that is stored (it holds an opening) is
 * attached to the project, and only a chat that does not exist is created.
 */
export async function ensureAgentChat(
  services: AgentServices,
  request: AgentChatRequest,
  knownProject?: WorkspaceLike,
): Promise<string> {
  const project = knownProject ?? await services.registry.create(request.projectPath, request.projectTitle)
  const existed = project.sessionIds.includes(request.sessionId)
  if (!existed) {
    if (await isStored(services.persistence, request.sessionId)) await project.attachSession(request.sessionId)
    else {
      const { sessionId } = await services.controller.create({ workspaceId: project.id, sessionId: request.sessionId, agentPreset: request.agentPreset })
      if (sessionId !== request.sessionId) throw new Error(`DSH made the chat "${sessionId}" instead of "${request.sessionId}", so the chat cannot be found again`)
    }
  }
  if (!existed || request.renameExisting === true) await services.controller.rename({ sessionId: request.sessionId, title: request.title })
  return request.sessionId
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
    const agents = ctx.get('agents')
    const command = agents === undefined ? undefined : async (chat: string, line: string): Promise<CommandOutcome | undefined> => {
      const live = agents.get(SessionId(chat))
      return live === undefined ? undefined : await runCommandLine(ctx, live, line, new AbortController().signal)
    }
    return { controller, registry, ...(persistence === undefined ? {} : { persistence }), ...(agents === undefined ? {} : { unload: unloader(ctx, agents) }), ...(command === undefined ? {} : { command }) }
  }
}

/**
 * A live agent as DSH's loop builds it: the public `Agent`, plus the scope its registrations hang from. DSH exposes the scope on `ReactLoopAgent` (declared by
 * `@deepseek-ai/dsh-agent-loop`) but not on the `Agent` interface, and gives a caller a dispose handle only for an agent it created itself; the scope is how a chat that
 * the web app started is unloaded. See `docs/specifications/dsh-api-contract.md`.
 */
type LiveAgent = Agent & { readonly scope: Scope }

/** How long a disposed chat may take to leave DSH's agent registry before the replacement is refused. */
const UNLOAD_WAIT_MS = 5000

/**
 * DSH has no call to unload an agent; disposing its scope is what its own teardown (a closed log, a released
 * registration) hangs from. `agent/disposed` says when it has left the registry; the bound is only a guard for a
 * teardown that never finishes.
 */
function unloader(ctx: Context, agents: { get(id: SessionId): Agent | undefined }): (chat: string) => Promise<void> {
  return async (chat) => {
    const live = agents.get(SessionId(chat)) as LiveAgent | undefined
    if (live === undefined) return
    let off = (): void => {}
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, UNLOAD_WAIT_MS)
        const settle = (done: () => void): void => { clearTimeout(timer); done() }
        off = ctx.on('agent/disposed', ({ agent }) => { if (agent.session.id === chat) settle(resolve) })
        void (async () => {
          try {
            await (live.scope.rawDispose ?? live.scope.dispose.bind(live.scope))()
            // The event is the answer; the bound only unblocks a teardown that never gets there.
          } catch (error) { settle(() => reject(error)) }
        })()
      })
    } finally { off() }
    if (agents.get(SessionId(chat)) !== undefined) throw new Error(`the chat ${chat} is still loaded and cannot be replaced`)
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
   * @param events - the whole log a chat that is new starts from, when it is made again from a session that was played (the opening is its first turn).
   * @throws {AgentUnavailableError} when there is an opening and no way to store it.
   */
  async ensure(sessionId: string, title: string, opening?: readonly NarrationSegment[], events?: readonly SessionEvent[]): Promise<string> {
    const services = this.services()
    const { registry, persistence } = services
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const wanted = chatSessionId(sessionId)
    const existed = project.sessionIds.includes(wanted)
    const stored = opening !== undefined && !existed && await isStored(persistence, wanted)
    if (opening !== undefined && !existed && !stored) {
      if (persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store a chat with an opening message')
      // A live agent that outlived its log (the chat was removed under it) still holds the log's name.
      await services.unload?.(wanted)
      await storeOpening(persistence, { id: wanted, cwd: project.path, agentPreset: AGENT_PRESET }, opening, events)
    }
    return await ensureAgentChat(services, { projectPath: project.path, projectTitle: PROJECT_TITLE, sessionId: wanted, agentPreset: AGENT_PRESET, title }, project)
  }

  /** Whether the chat of a session exists on this installation: in the project, or stored and waiting to be attached. */
  async has(sessionId: string): Promise<boolean> {
    const { registry, persistence } = this.services()
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const wanted = chatSessionId(sessionId)
    return project.sessionIds.includes(wanted) || await isStored(persistence, wanted)
  }

  /**
   * Put a log made again in the place of the chat's own, for a session whose folder came from another installation after the chat was
   * made. The old log is deleted first, and with it the chat's title, which is given again; DSH keeps the chat in its project, so the same id is stored again and `ensure` is not needed.
   */
  async replace(sessionId: string, title: string, events: readonly SessionEvent[], purge: (chat: string) => Promise<unknown>): Promise<void> {
    const { controller, registry, persistence, unload } = this.services()
    if (persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store a chat')
    const project = await registry.create(this.projectPath(), PROJECT_TITLE)
    const chat = chatSessionId(sessionId)
    await unload?.(chat)
    await purge(chat)
    await storeInitialEvents(persistence, { id: chat, cwd: project.path, agentPreset: AGENT_PRESET }, events)
    await controller.rename({ sessionId: chat, title })
  }

  /** Says something in the chat of a session as the player would; it is queued behind what the chat is doing. The chat must exist (`ensure`). */
  async send(sessionId: string, text: string): Promise<void> {
    const services = this.services()
    const chat = chatSessionId(sessionId)
    const ran = text.startsWith('/') ? await services.command?.(chat, text) : undefined
    if (ran !== undefined) {
      if (ran.kind === 'error') throw new CommandRefusedError(ran.text)
      return
    }
    await services.controller.prompt({ requestId: randomUUID(), sessionId: chat, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
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
