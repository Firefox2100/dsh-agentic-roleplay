import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares `ctx.roleplayState`.
import type {} from 'dsh-roleplay-state'
import { AgentSessions, agentServicesOf } from './host/agent/agent-sessions.ts'
import { Config } from './host/config.ts'
import { RoleplayOrchestration } from './host/orchestration/service.ts'
import { registerApi } from './host/http/index.ts'
import { deleteSession } from './host/sessions/delete-session.ts'
import { readChatSettings, writeChatSettings } from './host/sessions/chat-settings.ts'
import { openSession } from './host/sessions/open-session.ts'
import { listSessions } from './host/sessions/list-sessions.ts'
import { startSession } from './host/sessions/start-session.ts'
import { worldCharacters } from './host/sessions/world-characters.ts'
import { RoleplayRoot } from './host/storage/roleplay-root.ts'
import { WorldCatalog } from './host/worlds/catalog.ts'

export { Config } from './host/config.ts'
export type * from './host/orchestration/boundaries.ts'
export type { CharacterAction, CharacterFailure, CharacterReport, Commitment, Outcome, Result } from './host/orchestration/protocol.ts'
export { RoleplayOrchestration } from './host/orchestration/service.ts'
export const name = 'dsh-agentic-roleplay-core'

/** Sessions are kept by the state plugin, which the bundle installs with this one. */
export const inject = ['roleplayState']

export function apply(ctx: Context, config: Config): void {
  const root = new RoleplayRoot(ctx, config.rootPath)
  new RoleplayOrchestration(ctx)
  const worlds = new WorldCatalog(ctx, root)
  const agent = new AgentSessions(agentServicesOf(ctx), () => root.path)
  const settingsDeps = {
    sessionsDir: () => join(root.path, 'sessions'),
    pendingRecords: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).pendingCommits.list().length,
    clockMode: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).clock.get()?.mode,
    pendingConsolidation: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).consolidation.pending().length,
  }
  const deps = { worlds, state: ctx.roleplayState, agent, sessionsDir: () => join(root.path, 'sessions') }
  registerApi(ctx, {
    worlds,
    worldCharacters: worldId => worldCharacters(worlds, worldId),
    sessions: { list: () => listSessions(deps), start: request => startSession(deps, request), open: id => openSession(deps, id), delete: id => deleteSession(deps, id), readSettings: id => readChatSettings(settingsDeps, id), writeSettings: (id, value) => writeChatSettings(settingsDeps, id, value) },
  })
}
