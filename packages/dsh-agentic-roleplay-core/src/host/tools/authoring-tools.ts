import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { externalToolLimit } from '../orchestration/hooks.ts'
import type { AuthoringKind } from '../../shared/tools.ts'
import type { Switchboard } from '../../shared/settings.ts'
import { externalGiven, externalWithheld, type ToolRegistry } from './external.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayAuthoringTools: AuthoringTools
  }
}

/** Which of the tools other plugins registered for everyone each assistant of the authoring chats was given in the settings; read afresh, so a change applies at its next step. */
export class AuthoringTools extends Service {
  constructor(ctx: Context, private readonly board: () => Switchboard) {
    super(ctx, 'roleplayAuthoringTools')
  }

  /** What the assistant is given: the tools it may call on top of its own. */
  given(registry: ToolRegistry, kind: AuthoringKind): string[] {
    return externalGiven(registry, this.board(), kind)
  }

  /** What the assistant is not given and so does not see. */
  withheld(registry: ToolRegistry, kind: AuthoringKind): string[] {
    return externalWithheld(registry, this.board(), kind)
  }
}

/**
 * Takes the tools of other plugins away from an assistant of an authoring chat unless the settings gave it that tool, before its first request and again
 * at every step (a server may connect later). Helpers the assistant starts are not touched: they have no tools but their own.
 */
export function limitAuthoringAgent(agent: Agent, kind: AuthoringKind, tools: AuthoringTools): void {
  externalToolLimit(agent, tools.withheld(agent.ctx.tools, kind))
}

/** Installs the limit on the agents of the chats `kindOf` recognises, which a preset's listeners find among the agents of every chat of the preset and its helpers. */
export function limitAuthoringAgents(ctx: Context, kindOf: (chat: string) => AuthoringKind | undefined): void {
  const apply = (agent: Agent): void => {
    if (agent.session.header.origin === 'subagent') return
    const kind = kindOf(agent.session.id)
    if (kind !== undefined) limitAuthoringAgent(agent, kind, ctx.roleplayAuthoringTools)
  }
  ctx.on('agent/created', ({ agent }) => { apply(agent) })
  ctx.on('agent/pre-step', async (payload, next) => {
    apply(payload.agent)
    return await next()
  })
}
