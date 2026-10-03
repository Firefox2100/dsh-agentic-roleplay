import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from 'dsh-roleplay-state'
import { join } from 'node:path'
import { installHooks } from './host/orchestration/hooks.ts'
import { PROTOCOL, PROTOCOL_SECTION } from './host/orchestration/prompt.ts'
import { storesOf } from './host/orchestration/store.ts'
import { createTools, currentTurn } from './host/orchestration/tools.ts'
import { TurnEngine } from './host/orchestration/turn-engine.ts'
import type {} from './host/orchestration/service.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = 'dsh-agentic-roleplay-core/orchestration'

/**
 * Mounted by the `roleplay` agent preset, so it applies to roleplay chats only.
 * One instance serves every chat of the preset: state is kept per chat.
 */
export const inject = ['roleplayOrchestration', 'roleplayState', 'roleplayRoot', 'tools', 'subagents', 'systemPrompt']

export function apply(ctx: Context): void {
  const boundaries = () => ctx.roleplayOrchestration.boundaries
  const stores = storesOf(ctx.roleplayState, () => join(ctx.roleplayRoot.path, 'sessions'))
  const engine = new TurnEngine(boundaries, stores)

  ctx.systemPrompt.section({
    name: PROTOCOL_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: PROTOCOL,
    interpolate: false,
  })
  for (const tool of createTools({ engine, boundaries, subagents: ctx.subagents, turnOf: currentTurn })) ctx.tools.register(tool)
  installHooks(ctx, { engine, boundaries, stores })
}
