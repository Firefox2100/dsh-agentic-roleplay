import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from 'dsh-roleplay-state'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { recordKeeper } from './host/orchestration/committer.ts'
import { installHooks } from './host/orchestration/hooks.ts'
import { PROTOCOL, PROTOCOL_SECTION } from './host/orchestration/prompt.ts'
import { roleplaySessionOf } from './shared/chat.ts'
import { liveSettings } from './host/sessions/settings.ts'
import { storesOf } from './host/orchestration/store.ts'
import { sessionFolder } from 'dsh-roleplay-state'
import { currentTurn } from './host/orchestration/current-turn.ts'
import { createTools } from './host/orchestration/tools.ts'
import { TurnEngine } from './host/orchestration/turn-engine.ts'
import type {} from './host/orchestration/service.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = 'dsh-agentic-roleplay-core/orchestration'

/**
 * Mounted by the `roleplay` agent preset, so it applies to roleplay chats only.
 * One instance serves every chat of the preset: state is kept per chat.
 */
export const inject = ['roleplayOrchestration', 'roleplayState', 'roleplayRoot', 'tools', 'subagents', 'systemPrompt', 'agents']

export function apply(ctx: Context): void {
  const boundaries = () => ctx.roleplayOrchestration.boundaries
  const stores = storesOf(ctx.roleplayState, () => join(ctx.roleplayRoot.path, 'sessions'), message => { ctx.logger.warn(`roleplay: ${message}`) })
  const engine = new TurnEngine(boundaries, stores, message => { ctx.logger.warn(`roleplay: ${message}`) })

  ctx.effect(() => ctx.roleplayOrchestration.replace({ committer: recordKeeper({ agentOf: chat => ctx.agents.get(SessionId(chat)) }) }), 'roleplay: record keeper')
  ctx.effect(() => ctx.roleplayState.bind((agentSessionId) => {
    const id = roleplaySessionOf(agentSessionId)
    const agent = ctx.agents.get(SessionId(agentSessionId))
    if (id === undefined || agent === undefined) return undefined
    const sessionsDir = join(ctx.roleplayRoot.path, 'sessions')
    return { session: ctx.roleplayState.openSession(sessionsDir, id), turn: currentTurn(agent), policy: liveSettings(sessionFolder(sessionsDir, id)).memory }
  }), 'roleplay: state tools')
  ctx.systemPrompt.section({
    name: PROTOCOL_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: PROTOCOL,
    interpolate: false,
  })
  for (const tool of createTools({ engine, boundaries, stores, turnOf: currentTurn })) ctx.tools.register(tool)
  installHooks(ctx, { engine, boundaries, stores })
}
