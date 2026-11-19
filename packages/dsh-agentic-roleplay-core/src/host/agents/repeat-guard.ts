import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { FAILING_RUN, GUIDE_AFTER_FAILURES, REFUSALS_BEFORE_STOP } from './limits.ts'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'

type Chat = { calls: Map<string, number>; failures: Map<string, number>; refused: number; guides: Set<string>; pointed: Set<string> }

/**
 * Keeps an agent that is stuck from going on (found live: an assistant made one create-and-list pair 47 times in a review, a game master repeated one refused round resolution,
 * a review read entry 132, 133 ... 4000 of a card that has fewer):
 * - past `limit` identical calls in one turn the call is refused with a word that sends it on;
 * - past `FAILING_RUN` failures of one tool in a row, with whatever arguments, the tool is refused for the rest of the turn;
 * - a tool that has a format guide (`guideOf`) and keeps failing is refused once, with the guide named, until the guide was loaded with the skill tool, and the stop at `FAILING_RUN` names it too: telling a model to stop guessing does not tell it what is right;
 * - when the model goes on regardless the turn is ended.
 * The counts start over at the first step of every turn.
 * @param languageOf the language of the chat the call belongs to, or nothing when the guard does not apply to it.
 * @param guideOf the skill that says how to use a call correctly, when there is one.
 */
export function guardRepeatedCalls(ctx: Context, languageOf: (exec: ToolExecution) => string | undefined, limit: number, guideOf: (exec: ToolExecution) => string | undefined = () => undefined): void {
  const chats = new Map<string, Chat>()

  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step === 1) chats.delete(payload.agent.session.id)
    return await next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const chat = exec.agent?.session.id
    const language = chat === undefined || exec.agent?.session.header.origin === 'subagent' ? undefined : languageOf(exec)
    if (chat === undefined || language === undefined) return await next()
    const state = chats.get(chat) ?? { calls: new Map<string, number>(), failures: new Map<string, number>(), refused: 0, guides: new Set<string>(), pointed: new Set<string>() }
    chats.set(chat, state)
    const tr = translator(storyLanguageOf(language))
    if (exec.name === 'skill') {
      const loaded = (exec.arguments as { name?: unknown } | undefined)?.name
      if (typeof loaded === 'string') state.guides.add(loaded)
    }
    const failing = state.failures.get(exec.name) ?? 0
    const guide = guideOf(exec)
    if (guide !== undefined && failing >= GUIDE_AFTER_FAILURES && failing < FAILING_RUN && !state.guides.has(guide) && !state.pointed.has(exec.name)) {
      state.pointed.add(exec.name)
      if (guide !== undefined) return { kind: 'deny', reason: tr('`{tool}` failed {count} times in a row in this turn, with different arguments each time, so guessing more will not work. Do not call it again this turn: finish, say what is left, and name the guide `{guide}` as the reference for the form of the document.', { tool: exec.name, count: failing, guide }) }
      return { kind: 'deny', reason: tr('`{tool}` failed {count} times in a row. Before you call it again, load the guide `{guide}` with the skill tool and write the document the way it shows: it lists the fields, their types and the allowed values.', { tool: exec.name, count: failing, guide }) }
    }
    if (failing >= FAILING_RUN) {
      state.refused += 1
      if (state.refused > REFUSALS_BEFORE_STOP) exec.agent?.cancel({ kind: 'user' }, { keepInbox: true })
      if (guide !== undefined) return { kind: 'deny', reason: tr('`{tool}` failed {count} times in a row in this turn, with different arguments each time, so guessing more will not work. Do not call it again this turn: finish, say what is left, and name the guide `{guide}` as the reference for the form of the document.', { tool: exec.name, count: failing, guide }) }
      return { kind: 'deny', reason: tr('`{tool}` failed {count} times in a row in this turn, with different arguments each time, so guessing more will not work. Do not call it again this turn: use another tool to find what you need (a search or an overview), or finish and say what is left.', { tool: exec.name, count: failing }) }
    }
    const signature = `${exec.name}:${JSON.stringify(exec.arguments)}`
    const count = (state.calls.get(signature) ?? 0) + 1
    state.calls.set(signature, count)
    if (count <= limit) return await next()
    // a model that goes on after being refused is not reading the refusals: the turn is ended (found live: one call 442 times in a review turn)
    if (count > limit + REFUSALS_BEFORE_STOP) exec.agent?.cancel({ kind: 'user' }, { keepInbox: true })
    return { kind: 'deny', reason: tr('This exact call was already made {count} times in this turn with the same result. Do not repeat it: go on with the next step, or finish and say what is left.', { count: count - 1 }) }
  }, { prepend: true })

  ctx.on('tools/result', (exec, result) => {
    const state = exec.agent === undefined ? undefined : chats.get(exec.agent.session.id)
    if (state === undefined) return
    const failures = result.isError ? (state.failures.get(exec.name) ?? 0) + 1 : 0
    state.failures.set(exec.name, failures)
  })
}
