import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Boundaries, TurnStore } from './boundaries.ts'
import type { TurnEngine, TurnOwner } from './turn-engine.ts'
import { roleplaySessionOf } from './store.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    roleplay: { kind: 'roleplay' }
  }
}

export interface HookDeps {
  engine: TurnEngine
  boundaries: () => Boundaries
  stores: (chat: string) => TurnStore | undefined
}

const notice = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'roleplay' } })

/** The turn of the game master of a roleplay chat; characters and other chats have none. */
function ownerOf(agent: Agent, turn: number): TurnOwner | undefined {
  if (agent.session.header.origin === 'subagent') return undefined
  return roleplaySessionOf(agent.session.id) === undefined ? undefined : { chat: agent.session.id, turn }
}

/**
 * The listeners of a roleplay preset. Preset listeners are shared by every chat
 * that uses the preset and also hear the agents that chat spawns, so each one
 * first checks that it is looking at the game master of a roleplay chat.
 */
export function installHooks(ctx: Context, deps: HookDeps): void {
  const { engine, boundaries, stores } = deps

  // A turn cannot end before the round is resolved and recorded; the model decides
  // nothing about that, the data does.
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    const owner = ownerOf(agent, turn)
    if (owner === undefined) return
    // The turn does not end while the records of its rounds are still being written.
    await engine.flush(owner)
    const missing = engine.missing(owner)
    if (missing === undefined) return
    if (!engine.object(owner)) {
      ctx.logger.warn(`roleplay: ${owner.chat} ended turn ${turn} without finishing it (${missing})`)
      return
    }
    agent.steer(notice(`You may not end the turn yet: ${missing}.`))
  })

  // At the start of each turn the game master is told the state of the scene, and the
  // player's input is checked.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    const owner = ownerOf(payload.agent, payload.turn)
    const store = owner === undefined ? undefined : stores(owner.chat)
    if (owner === undefined || store === undefined) return decision

    const cast = store.cast()
    const text = payload.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
      .join('\n')
    const verdict = boundaries().inputValidator.validate({ text, turn: payload.turn, cast })
    const lines = [boundaries().sceneContext.scene({ cast, turn: payload.turn, input: text, story: store.story })]
    if (!verdict.ok) {
      engine.skip(owner)
      lines.push(`The player's input is refused: ${verdict.reason}. Do not ask any character to act; tell the player briefly why.`)
    }
    return { ...decision, messages: [...decision.messages, notice(lines.join('\n\n'))] }
  })
}

