import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { helpers } from './host/agents/child.ts'

export const name = '@dsh-agentic-roleplay/core/helper'
export const inject = ['tools', 'systemPrompt']

/**
 * The preset every helper agent (a character, the record keeper, the author, the chronicler) runs under. The preset is shared by all of them, so what is
 * one child's is found by its session id: its persona, and the equipment its caller set up for it when it was created.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'ROLEPLAY_HELPER_PERSONA',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    interpolate: false,
    text: (context) => {
      const agent = (context as { agent?: Agent }).agent
      return agent === undefined ? '' : helpers.get(agent.session.id)?.persona ?? ''
    },
  })
  ctx.on('agent/created', ({ agent }) => {
    helpers.get(agent.session.id)?.setup(agent)
  })
}
