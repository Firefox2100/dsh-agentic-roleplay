import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from './host/worlds/catalog.ts'
import { AuthoredWorldReader, authoredWorldReadTools } from './host/authoring/read-tools.ts'
import { authoredWorldWriteTools, authoringApproval } from './host/authoring/write-tools.ts'

export const name = 'dsh-agentic-roleplay-core/authoring'
export const inject = ['roleplayWorlds', 'tools', 'systemPrompt']

export function apply(ctx: Context): void {
  const reader = new AuthoredWorldReader(ctx.roleplayWorlds)
  for (const tool of authoredWorldReadTools(reader)) ctx.tools.register(tool)
  for (const tool of authoredWorldWriteTools(reader)) ctx.tools.register(tool)
  ctx.on('tools/pre-execute', authoringApproval)
  ctx.systemPrompt.section({
    name: 'WORLD_AUTHORING_PROCEDURE',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    interpolate: false,
    text: 'Use the read tools before making claims or edits. Keys are stable file identities, not display names. Before replacing an element, read its exact source document and preserve fields the requested change does not affect. Every write asks the user for one-time approval. If approval is rejected, cancelled or unavailable, do not retry it automatically: explain that nothing changed and ask how the user wants to proceed.',
  })
}
