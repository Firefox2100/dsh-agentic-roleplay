import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { silenceHarnessDevContext } from './host/prompts/dev-context.ts'
import type {} from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { sessionFolder } from '@dsh-agentic-roleplay/state'
import { helpers } from './host/agents/child.ts'
import { workspaceOf } from './host/workspace/folders.ts'
import { registerFoldersJail } from './host/workspace/jail.ts'
import { storyRoots } from './host/workspace/service.ts'

export const name = '@dsh-agentic-roleplay/core/helper'
export const inject = ['tools', 'systemPrompt']

/**
 * The preset every helper agent (a character, the record keeper, the author, the chronicler) runs under. The preset is shared by all of them, so what is
 * one child's is found by its session id: its persona, and the equipment its caller set up for it when it was created.
 */
export function apply(ctx: Context): void {
  silenceHarnessDevContext(ctx)
  ctx.systemPrompt.section({
    name: 'ROLEPLAY_HELPER_PERSONA',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    interpolate: false,
    text: (context) => {
      const agent = (context as { agent?: Agent }).agent
      return agent === undefined ? '' : helpers.get(agent.session.id)?.persona ?? ''
    },
  })
  // A helper works on the story's words and has no files: DSH's runtime facts (the directory, the file policy, approvals, delegation), in English, led a model writing Chinese to run on until its output limit.
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'roleplay: helper runtime context')
  ctx.systemPrompt.context({ name: 'working-directory:current', order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'), interpolate: false, text: '' })
  // The story's file-tool folders hold for the helpers too: they run under this preset, whose agents the orchestration plugin's own listener does not hear (a character wrote outside its folders live).
  const rootOf = (): string | undefined => ctx.get('roleplayRoot')?.path
  registerFoldersJail(ctx, {
    roots: async (session) => { const root = rootOf(); return root === undefined ? undefined : await storyRoots(root, sessionFolder(join(root, 'sessions'), session)) },
    workspace: () => workspaceOf(rootOf() ?? ''),
  })
  ctx.on('agent/created', ({ agent }) => {
    helpers.get(agent.session.id)?.setup(agent)
  })
  // a helper runs on the story's model, which a model that cannot share memory with it (a picture just made) is unloaded for first
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const selected = payload.agent.model.current()
    if (decision.kind === 'enter') await ctx.get('roleplayOrchestration')?.residency?.ensure('main', selected === undefined ? undefined : { provider: selected.provider, model: selected.model })
    return decision
  })
}
