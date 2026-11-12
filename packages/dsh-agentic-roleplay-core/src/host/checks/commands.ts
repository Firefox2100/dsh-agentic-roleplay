import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { CHECK_COMMANDS, CHECK_COMMAND_DESCRIPTIONS } from '../../shared/checks.ts'
import type { Prompting } from '../import/tools.ts'
import { registerCommands } from '../commands/registry.ts'

/** The tool each kit is run with, for the notice of a check command. */
const KIT_TOOLS = { consistency: 'check_world', fidelity: 'check_card', quality: 'check_quality', playability: 'check_play' } as const

/**
 * The check commands (`/check`, `/check-world`, ...) of a world authoring chat. Running one tells the assistant which kits to run and what to do with what they find, and what the person
 * added after the name (`deep` lets a model judge too) is passed on as it was typed.
 */
export function checkCommands(ctx: Context, prompting: Prompting): void {
  registerCommands(ctx, Object.entries(CHECK_COMMANDS).map(([name, kits]) => ({
    name,
    description: CHECK_COMMAND_DESCRIPTIONS[name] ?? name,
    hint: '[deep] [what to look at]',
    recordInput: false,
    handler: ({ agent, rawInput }) => {
      const world = authoredWorldOf(agent.session.id)
      if (world === undefined || agent.session.header.origin === 'subagent') return { kind: 'error', text: `/${name} runs in the authoring chat of a world` }
      const request = rawInput.trim()
      const notice = prompting.prompts().text('checks/notice', prompting.languages().get(world), { command: `/${name}`, tools: kits.map(kit => KIT_TOOLS[kit]).join(', '), request: request === '' ? '-' : request })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: notice }], source: { kind: 'roleplay' } }))
      return { kind: 'success', text: `Running ${kits.length === 1 ? 'the check' : 'the checks'}…` }
    },
  })))
}
