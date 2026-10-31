import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { CHECK_COMMANDS } from '../../shared/checks.ts'
import { parseAuthoringCommand } from '../../shared/authoring-commands.ts'
import type { Prompting } from '../import/tools.ts'

/** The tool each kit is run with, for the notice of a check command. */
const KIT_TOOLS = { consistency: 'check_world', fidelity: 'check_card', quality: 'check_quality' } as const

/** Hears the check commands (`/check`, `/check-world`) in an authoring chat and tells the assistant to run those kits and what to do with what they find. */
export function checkHooks(ctx: Context, prompting: Prompting): void {
  const authoring = (agent: Agent): string | undefined => (agent.session.header.origin === 'subagent' || authoredWorldOf(agent.session.id) === undefined ? undefined : agent.session.id)
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const chat = authoring(payload.agent)
    if (decision.kind !== 'enter' || payload.step !== 1 || chat === undefined) return decision
    const text = payload.messages.filter(message => message.source.kind === 'user').flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))).join('\n')
    const command = parseAuthoringCommand(text, Object.keys(CHECK_COMMANDS))
    if (command === undefined) return decision
    const world = authoredWorldOf(chat)
    const tools = CHECK_COMMANDS[command.name]!.map(kit => KIT_TOOLS[kit as keyof typeof KIT_TOOLS]).join(', ')
    const notice = prompting.prompts().text('checks/notice', world === undefined ? undefined : prompting.languages().get(world), { command: `/${command.name}`, tools, request: command.rest === '' ? '-' : command.rest })
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: notice }], source: { kind: 'roleplay' } })] }
  })
}
