import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from './tools.ts'

export const CONFIRM_CLAIM_TOOL = 'confirm_claim'

/**
 * The game master settles what the record keeper only proposed. Confirming is the one step that lets a claim reach the player's Heard page and a
 * character's own view, so it is a tool of the game master alone and a story may switch it off to leave the choice to the person.
 */
export function createClaimTools(deps: ToolDeps): ToolDefinition[] {
  return [defineTool({
    name: CONFIRM_CLAIM_TOOL,
    description: 'Settle a claim the record keeper proposed: its wording and the events linked to it are right, so its standing may be relied on and what a character heard of it may be shown to the player. Read the claim and its links with list_claims first; one that is wrong is not confirmed, it is left proposed.',
    parameters: { id: { type: 'integer', required: true, description: 'The id list_claims gives.' }, status: { type: 'string', enum: ['confirmed', 'proposed'], description: 'confirmed by default; proposed puts it back for review.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `Claim ${(value as { id: number }).id} is ${(value as { status: string }).status}.` }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const agent = exec.agent as Parameters<ToolDeps['turnOf']>[0] | undefined
      if (agent === undefined) throw new Error('the roleplay tools can only be called by an agent')
      const store = deps.stores(agent.session.id)
      if (store === undefined) throw new Error('this chat is not a roleplay session')
      const status = args.status ?? 'confirmed'
      store.story.edit({ turn: deps.turnOf(agent), claimStatuses: [{ claim: args.id, status }] })
      return { id: args.id, status }
    },
  })]
}
