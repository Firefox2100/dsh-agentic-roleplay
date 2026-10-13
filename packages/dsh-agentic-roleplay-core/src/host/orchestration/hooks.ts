import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Boundaries, TurnStore } from './boundaries.ts'
import type { TurnEngine, TurnOwner } from './turn-engine.ts'
import { roleplaySessionOf } from './store.ts'
import { parseOoc } from '../../shared/ooc.ts'
import type { Timelines } from '../timeline/service.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describePacingAdvice, pacingAdvice, plotAuthorNeeded } from '../pacing/director.ts'

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
  /** Registered for each chat that shows a preview, not for all. */
  previewTool: ToolDefinition
}

const notice = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'roleplay' } })

/** The turn of the game master of a roleplay chat; characters and other chats have none. */
function ownerOf(agent: Agent, turn: number): TurnOwner | undefined {
  if (agent.session.header.origin === 'subagent') return undefined
  return roleplaySessionOf(agent.session.id) === undefined ? undefined : { chat: agent.session.id, turn }
}

/** Where the withdrawal of an agent's preview tool is kept: on the agent, so that a reloaded plugin still finds what its earlier self registered. */
const PREVIEW_SHOWN = Symbol.for('dsh-agentic-roleplay.preview-tool')

/** Registers the preview tool on the agent of a chat that shows one, once, and withdraws it when the setting is turned off. */
export function previewToggle(tool: Parameters<Agent['ctx']['tools']['register']>[0]): (agent: Agent, enabled: boolean) => void {
  return (agent, enabled) => {
    const holder = agent as unknown as Record<symbol, (() => void) | undefined>
    const withdraw = holder[PREVIEW_SHOWN]
    if (enabled && withdraw === undefined) {
      try { holder[PREVIEW_SHOWN] = agent.ctx.tools.register(tool) } catch (error) {
        // A copy of this plugin from before a reload registered it and cannot be reached any more: the tool is there, which is all that is wanted.
        if (!(error instanceof Error) || !error.message.includes('already registered')) throw error
        holder[PREVIEW_SHOWN] = () => undefined
      }
    }
    else if (!enabled && withdraw !== undefined) { delete holder[PREVIEW_SHOWN]; withdraw() }
  }
}

/**
 * The listeners of a roleplay preset. Preset listeners are shared by every chat
 * that uses the preset and also hear the agents that chat spawns, so each one
 * first checks that it is looking at the game master of a roleplay chat.
 */
export function installHooks(ctx: Context, deps: HookDeps): void {
  const { engine, boundaries, stores, timelines, previewTool } = deps

  const showPreviewTool = previewToggle(previewTool)

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
    const owner = ownerOf(payload.agent, payload.turn)
    const store = owner === undefined ? undefined : stores(owner.chat)
    if (owner !== undefined && store !== undefined) showPreviewTool(payload.agent, store.settings().preview.enabled)
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    if (owner === undefined || store === undefined) return decision
    const text = payload.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
      .join('\n')
    await timelines.begin(owner.chat, payload.turn, text)

    const cast = store.cast()
    const ooc = parseOoc(text)
    const verdict = ooc === undefined ? boundaries().inputValidator.validate({ text, turn: payload.turn, cast }) : { ok: true as const }
    if (ooc !== undefined && ooc.request !== '') engine.beginOoc(owner, ooc.request, ooc.question)
    else if (ooc === undefined) engine.expectJudgement(owner)
    const queryVector = await store.queryVector(ooc?.request ?? text)
    store.clearNotes()
    store.lapseNotes(payload.turn)
    const { time, away, agenda } = store.beginTurn(payload.turn)
    if (store.settings().offstage.summary) store.addNote('away', payload.turn, agenda.moved.map(move => `${move.name} went to ${move.to}.`))
    const fired = engine.fireAtStart(owner)
    const world = { happened: fired.flatMap(entry => [...entry.events.map(text => `${entry.name}: ${text}`), ...entry.cues.map(cue => `${cue.names.join(' and ')} noticed: ${cue.text}`)]), beats: store.pendingBeats(), upcoming: store.upcoming(payload.turn) }
    const tracked = store.tracked()
    const lines = [boundaries().sceneContext.scene({ ...(tracked.length === 0 ? {} : { tracked }), time: { now: time, agenda, ...(away === undefined ? {} : { away }) }, ...(world.happened.length === 0 && world.beats.length === 0 && world.upcoming.length === 0 ? {} : { world }), cast, turn: payload.turn, input: text, story: store.story, items: { at: locationId => store.itemsAt(locationId, true), carried: characterId => store.carried(characterId) }, ...(queryVector === undefined ? {} : { queryVector }) })]
    const pacing = ooc === undefined ? pacingAdvice(store, payload.turn) : undefined
    if (pacing !== undefined) lines.push(describePacingAdvice(pacing))
    else if (ooc === undefined && plotAuthorNeeded(store, payload.turn)) lines.push(store.text('roleplay/plot-hint'))
    const rules = store.rules()
    if (rules.length > 0) lines.push(store.text('roleplay/rules', { rules: rules.map(rule => `- ${rule}`).join('\n') }))
    if (ooc !== undefined && ooc.request !== '') lines.push(store.text(ooc.question ? 'roleplay/ask-question' : 'roleplay/ooc-command', { request: ooc.request }))
    if (ooc !== undefined && ooc.request === '') {
      engine.skip(owner)
      lines.push(store.text('roleplay/ooc-empty', { command: ooc.question ? '/ask' : '/ooc' }))
    }
    if (!verdict.ok) {
      engine.skip(owner)
      lines.push(store.text('roleplay/input-refused', { reason: verdict.reason }))
    }
    return { ...decision, messages: [...decision.messages, notice(lines.join('\n\n'))] }
  })
}
