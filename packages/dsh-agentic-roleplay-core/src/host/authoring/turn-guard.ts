import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { cutOff, finishOf } from '../agents/cut-off.ts'
import { AUTHORING_NUDGES, AUTHORING_SAME_CALL } from '../agents/limits.ts'
import { guardRepeatedCalls } from '../agents/repeat-guard.ts'
import type { PromptLibrary } from '../prompts/library.ts'

/**
 * What keeps an authoring assistant (a chat that edits a world, a preset or a lorebook) from running away, besides the limit on what one request may write.
 * - Its thinking level is the one the settings name for these assistants, when its model offers that level: thinking without end filled the whole request and left a turn with nothing done.
 * - A reply that ran out of room is steered back to act or to sum up. DSH ends a turn whose reply was cut off as soon as it stops, so every stop after the cut-off is steered too, until the assistant finishes by itself.
 * @param languageOf the language the chat's prompts are in, or nothing when the chat is not an authoring chat of this preset.
 * @param reasoning the thinking level the settings give the assistants; empty leaves the chat's own.
 */
export function guardAuthoringTurns(ctx: Context, prompts: () => PromptLibrary, languageOf: (chat: string) => string | undefined, reasoning: () => string = () => ''): void {
  const nudged = new Map<string, number>()
  guardRepeatedCalls(ctx, exec => (exec.agent === undefined ? undefined : languageOf(exec.agent.session.id)), AUTHORING_SAME_CALL)

  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const level = reasoning()
    if (level === '' || payload.agent.session.header.origin === 'subagent' || languageOf(payload.agent.session.id) === undefined || config.reasoningEffort === level) return config
    try {
      const info = await payload.agent.ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal)
      if (info.reasoning?.efforts.some(effort => effort.id === level) !== true) return config
    } catch { return config }
    return { ...config, reasoningEffort: ReasoningEffortId(level) }
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (agent.session.header.origin === 'subagent') return
    const language = languageOf(agent.session.id)
    if (language === undefined) return
    const key = `${agent.session.id}:${turn}`
    const told = nudged.get(key) ?? 0
    // after a cut-off the turn ends at every stop unless it is steered; the assistant's own last word (`stop`) ends it for good
    const goOn = cutOff(agent) || (told > 0 && finishOf(agent) !== 'stop')
    if (!goOn) { nudged.delete(key); return }
    if (told >= AUTHORING_NUDGES) return
    nudged.set(key, told + 1)
    agent.steer(createUserMessage({ content: [{ type: 'text', text: prompts().text('import/cut-off', language) }], source: { kind: 'roleplay' } }))
  })
}
