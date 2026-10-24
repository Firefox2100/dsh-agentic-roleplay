import type { Context } from '@deepseek-ai/cordis'
import { languageOf, translator } from 'dsh-roleplay-model'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { tokensOf } from '../agents/usage.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Boundaries, TurnStore } from './boundaries.ts'
import type { TurnEngine, TurnOwner } from './turn-engine.ts'
import { roleplaySessionOf } from './store.ts'
import { parseOoc } from '../../shared/ooc.ts'
import { parseRoll } from '../../shared/roll.ts'
import { rollPlain } from '@dsh-agentic-roleplay/state'
import type { Timelines } from '../timeline/service.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { toolEnabled } from '../../shared/tools.ts'
import { externalWithheld } from '../tools/external.ts'
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
  /** The game master's optional tools: each is registered on the agent of a chat that has it switched on, and withdrawn when it is switched off. */
  optionalTools?: readonly ToolDefinition[]
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

/** Where the withdrawals of an agent's optional tools are kept, by tool name: on the agent, so that a reloaded plugin still finds what its earlier self registered. */
const OPTIONAL_SHOWN = Symbol.for('dsh-agentic-roleplay.optional-tools')

/** Puts an agent's optional tools in line with the switches: registers the ones that are on and not yet there, withdraws the ones that are off. */
export function optionalToolSwitch(tools: readonly ToolDefinition[]): (agent: Agent, enabled: (tool: string) => boolean) => void {
  return (agent, enabled) => {
    const holder = agent as unknown as Record<symbol, Map<string, () => void> | undefined>
    const shown = holder[OPTIONAL_SHOWN] ??= new Map<string, () => void>()
    for (const tool of tools) {
      const withdraw = shown.get(tool.name)
      if (enabled(tool.name) && withdraw === undefined) {
        try { shown.set(tool.name, agent.ctx.tools.register(tool)) } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('already registered')) throw error
          shown.set(tool.name, () => undefined)
        }
      } else if (!enabled(tool.name) && withdraw !== undefined) {
        shown.delete(tool.name)
        withdraw()
      }
    }
  }
}

/** Where an agent's withdrawal of the external tools it was not given is kept: on the agent, so that a reloaded plugin still finds what its earlier self set. */
const EXTERNAL_LIMIT = Symbol.for('dsh-agentic-roleplay.external-limit')

/**
 * Takes away from an agent the tools other plugins registered for everyone that it was not given. A story gives the game master such tools (a file or
 * shell tool, an MCP server's) by switching them on; without it the agent has none of them. The limit follows the settings as they change.
 */
export function externalToolLimit(agent: Agent, withheld: readonly string[]): void {
  const holder = agent as unknown as Record<symbol, { key: string; lift: () => void } | undefined>
  const key = [...withheld].sort((a, b) => a.localeCompare(b)).join('\n')
  const current = holder[EXTERNAL_LIMIT]
  if (current?.key === key) return
  current?.lift()
  delete holder[EXTERNAL_LIMIT]
  if (withheld.length > 0) holder[EXTERNAL_LIMIT] = { key, lift: agent.ctx.tools.restrict({ deny: [...withheld] }) }
}

/**
 * The listeners of a roleplay preset. Preset listeners are shared by every chat
 * that uses the preset and also hear the agents that chat spawns, so each one
 * first checks that it is looking at the game master of a roleplay chat.
 */
export function installHooks(ctx: Context, deps: HookDeps): void {
  const { engine, boundaries, stores, timelines, previewTool } = deps

  const showPreviewTool = previewToggle(previewTool)
  const showOptionalTools = optionalToolSwitch(deps.optionalTools ?? [])
  /** The tools of the game master as the chat's settings say: its optional ones, and none of other plugins' that it was not given. */
  const applyTools = (agent: Agent, store: TurnStore): void => {
    const { tools } = store.settings()
    showOptionalTools(agent, tool => toolEnabled(tools, 'gameMaster', tool))
    externalToolLimit(agent, externalWithheld(agent.ctx.tools, tools, 'gameMaster'))
  }

  // Before its first request: a tool it was not given is never seen, not even on the first step.
  ctx.on('agent/created', ({ agent }) => {
    const owner = ownerOf(agent, 0)
    const store = owner === undefined ? undefined : stores(owner.chat)
    if (store === undefined) return
    // The tools are in place before the first request: one registered afterwards changes the request's tool list and with it the start of the prompt, which is what a server's cache is keyed on.
    showPreviewTool(agent, store.settings().preview.enabled)
    applyTools(agent, store)
  })

  // The turn that ended is where the next one will have to be cut from.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent' || roleplaySessionOf(session.id) === undefined) return
    timelines.ended(session.id, session, event.seq as number)
    const events = session.snapshotEvents()
    const began = events.findLastIndex(entry => entry.type === 'turn/start')
    const start = began === -1 ? undefined : events[began]
    if (start?.type === 'turn/start') stores(session.id)?.recordUsage?.(start.data.turn, tokensOf(events.slice(began)))
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
    if (!engine.object(owner, missing)) {
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
    if (owner !== undefined && store !== undefined) {
      showPreviewTool(payload.agent, store.settings().preview.enabled)
      applyTools(payload.agent, store)
    }
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    if (owner === undefined || store === undefined) return decision
    const text = payload.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
      .join('\n')
    if (!store.settings().background.concurrent) await engine.quiesce(owner.chat)
    await timelines.begin(owner.chat, payload.turn, text)

    const cast = store.cast()
    const ooc = parseOoc(text)
    const verdict = ooc === undefined ? boundaries().inputValidator.validate({ text, turn: payload.turn, cast }) : { ok: true as const }
    if (ooc !== undefined && ooc.request !== '') engine.beginOoc(owner, ooc.request, ooc.question)
    else if (ooc === undefined) { engine.expectJudgement(owner); engine.noteInput(owner, text) }
    const queryVector = await store.queryVector(ooc?.request ?? text)
    store.clearNotes()
    store.lapseNotes(payload.turn)
    const { time, away, agenda } = store.beginTurn(payload.turn)
    const tr = translator(languageOf(store.settings().prompts.language))
    if (store.settings().offstage.summary) store.addNote('away', payload.turn, agenda.moved.map(move => tr('{name} went to {place}.', { name: move.name, place: move.to })))
    const fired = engine.fireAtStart(owner)
    const world = { happened: fired.flatMap(entry => [...entry.events.map(text => `${entry.name}: ${text}`), ...entry.cues.map(cue => tr('{names} noticed: {text}', { names: cue.names.join(tr(' and ')), text: cue.text }))]), beats: store.pendingBeats(), upcoming: store.upcoming(payload.turn) }
    const tracked = store.tracked()
    const lines = [boundaries().sceneContext.scene({ ...(tracked.length === 0 ? {} : { tracked }), time: { now: time, agenda, ...(away === undefined ? {} : { away }) }, ...(world.happened.length === 0 && world.beats.length === 0 && world.upcoming.length === 0 ? {} : { world }), cast, turn: payload.turn, input: text, story: store.story, items: { at: locationId => store.itemsAt(locationId, true), carried: characterId => store.carried(characterId) }, language: store.settings().prompts.language, ...(queryVector === undefined ? {} : { queryVector }) })]
    const pacing = ooc === undefined ? pacingAdvice(store, payload.turn) : undefined
    if (pacing !== undefined) lines.push(describePacingAdvice(pacing))
    else if (ooc === undefined && plotAuthorNeeded(store, payload.turn)) lines.push(store.text('roleplay/plot-hint'))
    const rules = store.rules()
    if (rules.length > 0) lines.push(store.text('roleplay/rules', { rules: rules.map(rule => `- ${rule}`).join('\n') }))
    const wanted = ooc === undefined ? parseRoll(text) : undefined
    if (wanted !== undefined) {
      try {
        const made = rollPlain(wanted.expression)
        const roll = store.story.dice.record({ turn: payload.turn, expression: made.expression, faces: made.faces, kept: made.kept, modifier: made.modifier, total: made.total, value: made.total, reason: wanted.reason === '' ? tr('the player\'s roll') : wanted.reason, by: 'player' })
        lines.push(tr('The player rolled {dice} ({reason}) and got {total}: dice {faces}. This is a fact, decided by the dice: take it into account when you judge the attempt and decide what happens.', { dice: roll.expression, reason: roll.reason, total: roll.total, faces: `[${roll.faces.join(', ')}]` }))
      } catch (error) {
        engine.skip(owner)
        lines.push(store.text('roleplay/input-refused', { reason: error instanceof Error ? error.message : String(error) }))
      }
    }
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
