import { Service, type Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

/** The directory collaborator the sub-agent service needs, without the filesystem or the prompt context the real one brings. */
class FixtureWorkingDirectory extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
  }

  get(session: Agent['session']): string {
    return session.header.cwd ?? process.cwd()
  }

  set(): Promise<void> {
    return Promise.resolve()
  }

  async ensure(agent: Agent): Promise<string> {
    return this.get(agent.session)
  }
}

/** The services an agent loop needs; the context owns them and unloads them with itself. */
export async function mountAgentServices(ctx: Context): Promise<void> {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(FixtureWorkingDirectory)
}
