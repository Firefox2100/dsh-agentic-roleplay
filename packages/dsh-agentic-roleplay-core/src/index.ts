import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares `ctx.roleplayState`.
import type {} from 'dsh-roleplay-state'
import { AgentSessions, agentServicesOf } from './host/agent/agent-sessions.ts'
import { Config } from './host/config.ts'
import { registerApi } from './host/http/index.ts'
import { deleteSession } from './host/sessions/delete-session.ts'
import { openSession } from './host/sessions/open-session.ts'
import { listSessions } from './host/sessions/list-sessions.ts'
import { startSession } from './host/sessions/start-session.ts'
import { worldCharacters } from './host/sessions/world-characters.ts'
import { RoleplayRoot } from './host/storage/roleplay-root.ts'
import { WorldCatalog } from './host/worlds/catalog.ts'

export { Config } from './host/config.ts'
export const name = 'dsh-agentic-roleplay-core'

/** Sessions are kept by the state plugin, which the bundle installs with this one. */
export const inject = ['roleplayState']

export function apply(ctx: Context, config: Config): void {
  const root = new RoleplayRoot(ctx, config.rootPath)
  const worlds = new WorldCatalog(ctx, root)
  const agent = new AgentSessions(agentServicesOf(ctx), () => root.path)
  const deps = { worlds, state: ctx.roleplayState, agent, sessionsDir: () => join(root.path, 'sessions') }
  registerApi(ctx, {
    worlds,
    worldCharacters: worldId => worldCharacters(worlds, worldId),
    sessions: { list: () => listSessions(deps), start: request => startSession(deps, request), open: id => openSession(deps, id), delete: id => deleteSession(deps, id) },
  })
}
