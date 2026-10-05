import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Boundaries, TurnStore } from './boundaries.ts'
import type { TurnEngine, TurnOwner } from './turn-engine.ts'
import { roleplaySessionOf } from './store.ts'
import type { Timelines } from '../timeline/service.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    roleplay: { kind: 'roleplay' }
  }
}

export interface HookDeps {
  engine: TurnEngine
  boundaries: () => Boundaries
  stores: (chat: string) => TurnStore | undefined
  timelines: Timelines
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
  const { engine, boundaries, stores, timelines } = deps

  // The turn that ended is where the next one will have to be cut from.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent' || roleplaySessionOf(session.id) === undefined) return
    timelines.ended(session.id, session, event.seq as number)
  })

  // A chat DSH makes as a branch of a roleplay chat (its fork, from any button) gets a session of its own, made from the state where it was cut.
  ctx.on('agent/created', async ({ agent }) => {
    const { header } = agent.session
    if (header.origin === 'subagent' || !header.isSeeded || header.parentSession === undefined) return
    if (roleplaySessionOf(agent.session.id) === undefined || roleplaySessionOf(header.parentSession) === undefined) return
    await timelines.adopt(agent.session.id, header.parentSession, agent.session.inheritedEventCount - 1, agent)
  })

  // A turn cannot end before the round is resolved and recorded; the model decides
  // nothing about that, the data does.
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    const owner = ownerOf(agent, turn)
    if (owner === undefined) return
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
    // What the last turn left to be written is written before anything is recalled; the player was shown the output long ago.
    await engine.settle(owner.chat)
    const text = payload.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
      .join('\n')
    await timelines.begin(owner.chat, payload.turn, text)

    const cast = store.cast()
    const verdict = boundaries().inputValidator.validate({ text, turn: payload.turn, cast })
    const queryVector = await store.queryVector(text)
    store.clearNotes()
    store.lapseNotes(payload.turn)
    const { time, away, agenda } = store.beginTurn(payload.turn)
    const fired = engine.fireAtStart(owner)
    const world = { happened: fired.flatMap(entry => [...entry.events.map(text => `${entry.name}: ${text}`), ...entry.cues.map(cue => `${cue.names.join(' and ')} noticed: ${cue.text}`)]), beats: store.pendingBeats(), upcoming: store.upcoming(payload.turn) }
    const tracked = store.tracked()
    const lines = [boundaries().sceneContext.scene({ ...(tracked.length === 0 ? {} : { tracked }), time: { now: time, agenda, ...(away === undefined ? {} : { away }) }, ...(world.happened.length === 0 && world.beats.length === 0 && world.upcoming.length === 0 ? {} : { world }), cast, turn: payload.turn, input: text, story: store.story, items: { at: locationId => store.itemsAt(locationId, true), carried: characterId => store.carried(characterId) }, ...(queryVector === undefined ? {} : { queryVector }) })]
    if (!verdict.ok) {
      engine.skip(owner)
      lines.push(`The player's input is refused: ${verdict.reason}. Do not ask any character to act; tell the player briefly why.`)
    }
    return { ...decision, messages: [...decision.messages, notice(lines.join('\n\n'))] }
  })
}

