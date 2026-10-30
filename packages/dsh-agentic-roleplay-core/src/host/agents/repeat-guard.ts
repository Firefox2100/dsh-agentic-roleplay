import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { REFUSALS_BEFORE_STOP } from './limits.ts'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'

/**
 * Keeps an agent that is stuck from making the same call again and again (found live: an assistant made one create-and-list pair 47 times in a review, a game master repeated one
 * refused round resolution): past `limit` identical calls in one turn the call is refused with a word that sends it on, and when it goes on regardless the turn is ended. The count starts over at the first step of every turn.
 * @param languageOf the language of the chat the call belongs to, or nothing when the guard does not apply to it.
 */
export function guardRepeatedCalls(ctx: Context, languageOf: (exec: ToolExecution) => string | undefined, limit: number): void {
  const calls = new Map<string, Map<string, number>>()

  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step === 1) calls.delete(payload.agent.session.id)
    return await next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const chat = exec.agent?.session.id
    const language = chat === undefined || exec.agent?.session.header.origin === 'subagent' ? undefined : languageOf(exec)
    if (chat === undefined || language === undefined) return await next()
    const signature = `${exec.name}:${JSON.stringify(exec.arguments)}`
    const seen = calls.get(chat) ?? new Map<string, number>()
    calls.set(chat, seen)
    const count = (seen.get(signature) ?? 0) + 1
    seen.set(signature, count)
    if (count <= limit) return await next()
    // a model that goes on after being refused is not reading the refusals: the turn is ended (found live: one call 442 times in a review turn)
    if (count > limit + REFUSALS_BEFORE_STOP) exec.agent?.cancel({ kind: 'user' }, { keepInbox: true })
    const tr = translator(storyLanguageOf(language))
    return { kind: 'deny', reason: tr('This exact call was already made {count} times in this turn with the same result. Do not repeat it: go on with the next step, or finish and say what is left.', { count: count - 1 }) }
  }, { prepend: true })
}
