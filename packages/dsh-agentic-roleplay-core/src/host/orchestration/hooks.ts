import { TurnTraces, tracerOf } from '../observability/trace.ts'
import type { Context } from '@deepseek-ai/cordis'
import { languageOf, translator } from 'dsh-roleplay-model'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { tokensOf } from '../agents/usage.ts'
import { masterTrace } from '../diagnostics/master-trace.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Boundaries, SceneReport, TurnStore } from './boundaries.ts'
import type { PromptPart, SceneSelection } from '../../shared/trace.ts'
import { estimateTokens } from '../diagnostics/estimate.ts'
import type { TurnEngine, TurnOwner } from './turn-engine.ts'
import { roleplaySessionOf } from './store.ts'
import { parseOoc } from '../../shared/ooc.ts'
import { characterRunner } from './character-runner.ts'
import { parseDream } from '../../shared/dream.ts'
import { parseRoll } from '../../shared/roll.ts'
import { parseWait } from '../../shared/wait.ts'
import type { RollReplay } from '../dice/replay.ts'
import { describeInstant, rollPlain } from '@dsh-agentic-roleplay/state'
import type { Timelines } from '../timeline/service.ts'
import { MASTER_SAME_CALL } from '../agents/limits.ts'
import { commandFlagKey, type StoryCommand } from '../../shared/commands.ts'
import { guardRepeatedCalls } from '../agents/repeat-guard.ts'
import { finishOf } from '../agents/cut-off.ts'
import { RunawayThinking } from './runaway.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { externalEnabled, toolEnabled } from '../../shared/tools.ts'
import { foldersLine } from '../workspace/describe.ts'
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
  /** Dice that fall the same way when a turn is played again, when the story asks for it. */
  rolls?: RollReplay
  /** The folders the file tools of a story reach, so that the game master is told where they are. */
  folders?(chat: string): Promise<{ path: string; write: boolean }[] | undefined>
  /** Registered for each chat that shows a preview, not for all. */
  previewTool: ToolDefinition
  /** The game master's optional tools: each is registered on the agent of a chat that has it switched on, and withdrawn when it is switched off. */
  optionalTools?: readonly ToolDefinition[]
  /** The turn traces, shared with what delivers the output. */
  traces?: TurnTraces
}

/** DSH's file tools that a story may give its game master. */
const FILE_TOOLS = ['read', 'read_image', 'write', 'edit', 'glob', 'grep', 'apply_patch'] as const

const notice = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'roleplay' } })

/** The turn of the game master of a roleplay chat; characters and other chats have none. */
function ownerOf(agent: Agent, turn: number): TurnOwner | undefined {
  if (agent.session.header.origin === 'subagent') return undefined
  return roleplaySessionOf(agent.session.id) === undefined ? undefined : { chat: agent.session.id, turn }
}

/** Where an agent keeps the fact that its conditional tools are registered: on the agent, so that a reloaded plugin does not register them a second time. */
const CONDITIONAL_REGISTERED = Symbol.for('dsh-agentic-roleplay.conditional-tools')

/** A tool and the step-time condition under which the agent may call it. */
export interface ConditionalTool {
  tool: ToolDefinition
  when: () => boolean
}

/**
 * Registers an agent's switchable tools once, before its first request. DSH asks each condition at every step and leaves a tool out of the request while
 * it is false, so a setting changed during a story applies at the next step without registering or withdrawing anything.
 */
export function registerConditionalTools(agent: Agent, entries: readonly ConditionalTool[]): void {
  const holder = agent as unknown as Record<symbol, true | undefined>
  if (holder[CONDITIONAL_REGISTERED] === true) return
  for (const { tool, when } of entries) {
    try { agent.ctx.tools.register(tool, { when }) } catch (error) {
      // A copy of this plugin from before a reload registered it and cannot be reached any more: the tool is there, which is all that is wanted.
      if (!(error instanceof Error) || !error.message.includes('already registered')) throw error
    }
  }
  holder[CONDITIONAL_REGISTERED] = true
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
/** Whether a trigger that has the world author make a person waits on the flag of a command: then the world, not the game master, brings the person in. */
export function commandBringsPeopleIn(store: Pick<TurnStore, 'story'>, command: StoryCommand): boolean {
  const flag = commandFlagKey(command)
  return store.story.triggers.list().some(trigger => JSON.stringify(trigger.condition).includes(`"${flag}"`) && trigger.effects.some(effect => effect.type === 'beat' && effect.dispatch === 'author'))
}

export function installHooks(ctx: Context, deps: HookDeps): void {
  const { engine, boundaries, stores, timelines, previewTool } = deps

  /** The tools of the game master as the chat's settings say: its optional ones, and none of other plugins' that it was not given. */
  const applyLimit = (agent: Agent, store: TurnStore): void => {
    externalToolLimit(agent, externalWithheld(agent.ctx.tools, store.settings().tools, 'gameMaster'))
  }
  const conditionsOf = (chat: string): ConditionalTool[] => {
    const settings = () => stores(chat)?.settings()
    return [
      { tool: previewTool, when: () => settings()?.preview.enabled === true },
      ...(deps.optionalTools ?? []).map(tool => ({ tool, when: () => { const current = settings(); return current !== undefined && toolEnabled(current.tools, 'gameMaster', tool.name) } })),
    ]
  }

  const runaway = new RunawayThinking()
  const turns = deps.traces ?? new TurnTraces(() => tracerOf(ctx))
  engine.observe = (chat, round) => {
    const span = turns.child(chat, { name: round.attempt === 1 ? 'round' : 'round (retry)', kind: 'span', input: { characters: round.characters, ...round.away ? { away: true } : {} }, metadata: { turn: round.turn, attempt: round.attempt } })
    return (result) => {
      if (span === undefined) return
      if (result instanceof Error) { span.end({ level: 'ERROR', statusMessage: result.message }); return }
      span.end({ output: { acted: result.reports.map(report => ({ character: report.name, intent: report.intent, commitment: report.commitment })), failed: result.failures.map(failure => ({ character: failure.name, reason: failure.reason })) } })
    }
  }

  // A game master that sends the same refused call over and over is told to move on, as an authoring assistant is.
  guardRepeatedCalls(ctx, exec => {
    const owner = exec.agent === undefined ? undefined : ownerOf(exec.agent, 0)
    return owner === undefined ? undefined : stores(owner.chat)?.settings().prompts.language
  }, MASTER_SAME_CALL)

  // Before its first request: a tool it was not given is never seen, not even on the first step.
  ctx.on('agent/created', ({ agent }) => {
    const owner = ownerOf(agent, 0)
    const store = owner === undefined ? undefined : stores(owner.chat)
    if (store === undefined) return
    // The tools are in place before the first request: one registered afterwards changes the request's tool list and with it the start of the prompt, which is what a server's cache is keyed on.
    registerConditionalTools(agent, conditionsOf(agent.session.id))
    applyLimit(agent, store)
  })

  // The turn that ended is where the next one will have to be cut from.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent' || roleplaySessionOf(session.id) === undefined) return
    ctx.roleplayOrchestration.recovery.clear(session.id)
    turns.end(session.id)
    timelines.ended(session.id, session, event.seq as number)
    const events = session.snapshotEvents()
    const began = events.findLastIndex(entry => entry.type === 'turn/start')
    const start = began === -1 ? undefined : events[began]
    if (start?.type !== 'turn/start') return
    const store = stores(session.id)
    store?.recordUsage?.(start.data.turn, tokensOf(events.slice(began)), Math.max(0, event.time - start.time))
    try { store?.recordTrace?.(start.data.turn, { ...masterTrace(events.slice(began)), endedAt: event.time }) } catch (error) { ctx.logger.warn(`roleplay: the trace of turn ${start.data.turn} could not be kept: ${error instanceof Error ? error.message : String(error)}`) }
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
    if (!engine.object(owner, missing, finishOf(agent) === 'tool-calls')) {
      ctx.logger.warn(`roleplay: ${owner.chat} ended turn ${turn} without finishing it (${missing})`)
      return
    }
    agent.steer(notice(`You may not end the turn yet: ${missing}.`))
  })

  // A tool call that could not be read is no reason to end the turn: the step is run again, and only a failure that goes on stands.
  ctx.on('agent/request-error', async ({ agent, turn, failure }, next) => {
    const owner = ownerOf(agent, turn)
    if (owner !== undefined && ctx.roleplayOrchestration.recovery.retry(owner.chat, turn, failure)) {
      ctx.logger.warn(`roleplay: ${owner.chat} turn ${turn}: the game master's call could not be read, running the step again`)
      return { kind: 'retry' }
    }
    return next()
  })

  // At the start of each turn the game master is told the state of the scene, and the
  // player's input is checked.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    // the story's model, for the game master and every helper under it: whatever was loaded in its way is unloaded first
    const selected = payload.agent.model.current()
    if (decision.kind === 'enter') await ctx.roleplayOrchestration.residency?.ensure('main', selected === undefined ? undefined : { provider: selected.provider, model: selected.model })
    const owner = ownerOf(payload.agent, payload.turn)
    if (decision.kind === 'enter' && owner !== undefined) await runaway.step(owner.chat, payload.agent, payload.step)
    const store = owner === undefined ? undefined : stores(owner.chat)
    if (owner !== undefined && store !== undefined) {
      applyLimit(payload.agent, store)
    }
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    if (owner === undefined || store === undefined) return decision
    const text = payload.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
      .join('\n')
    if (!store.settings().background.concurrent) await engine.quiesce(owner.chat, { skipOptional: true })
    await ctx.roleplayOrchestration.unitFree(owner.chat)
    const began = await timelines.begin(owner.chat, payload.turn, text)
    turns.begin(owner.chat, payload.turn, text)
    deps.rolls?.begin(owner.chat, store.story.metadata.get().id, began.parent)

    const cast = store.cast()
    const ooc = parseOoc(text)
    const command = ooc === undefined ? /^\/([\p{L}\p{N}_]+)/u.exec(text.trim())?.[1] : undefined
    const used = store.raiseCommand?.(command, payload.turn)
    const dream = ooc === undefined ? parseDream(text) : undefined
    const verdict = ooc === undefined ? boundaries().inputValidator.validate({ text, turn: payload.turn, cast }) : { ok: true as const }
    if (ooc !== undefined && ooc.request !== '') engine.beginOoc(owner, ooc.request, ooc.question)
    else if (ooc === undefined) { if (dream === undefined) engine.expectJudgement(owner); engine.noteInput(owner, text) }
    const queryVector = await store.queryVector(ooc?.request ?? text)
    store.clearNotes()
    store.lapseNotes(payload.turn)
    const { time, away, agenda } = store.beginTurn(payload.turn)
    const tr = translator(languageOf(store.settings().prompts.language))
    if (store.settings().offstage.summary) store.addNote('away', payload.turn, agenda.moved.map(move => tr('{name} went to {place}.', { name: move.name, place: move.to })))
    const arrived = store.autonomy?.inbox() ?? []
    const fired = engine.fireAtStart(owner)
    const world = { happened: fired.flatMap(entry => [...entry.events.map(text => `${entry.name}: ${text}`), ...entry.cues.map(cue => tr('{names} noticed: {text}', { names: cue.names.join(tr(' and ')), text: cue.text }))]), beats: store.pendingBeats(), upcoming: store.upcoming(payload.turn) }
    const tracked = store.tracked()
    const sections: PromptPart[] = []
    let selection: SceneSelection | undefined
    const report: SceneReport = { section: (id, text) => { sections.push({ id, tokens: estimateTokens(text) }) }, selected: (found) => { selection = found } }
    const lines = [boundaries().sceneContext.scene({ report, ...(tracked.length === 0 ? {} : { tracked }), time: { now: time, agenda, ...(away === undefined ? {} : { away }) }, ...(world.happened.length === 0 && world.beats.length === 0 && world.upcoming.length === 0 ? {} : { world }), cast, turn: payload.turn, input: text, story: store.story, items: { at: locationId => store.itemsAt(locationId, true), carried: characterId => store.carried(characterId) }, language: store.settings().prompts.language, ...(queryVector === undefined ? {} : { queryVector }) })]
    const pacing = ooc === undefined ? pacingAdvice(store, payload.turn) : undefined
    const addLine = (id: string, text: string): void => { lines.push(text); sections.push({ id, tokens: estimateTokens(text) }) }
    if (used !== undefined) addLine('command', [tr('The player used the world\'s command /{word}: {description} It is part of the story, not an out-of-character command: play it in the story. The world raises and lowers the command\'s own flag itself: never change it.', { word: used.word, description: used.description }), ...(commandBringsPeopleIn(store, used) ? [tr('The world itself brings in anyone this command calls for, after this turn: do not make them up yourself with expand_world.')] : [])].join(' '))
    if (pacing !== undefined) addLine('pacing', describePacingAdvice(pacing))
    else if (ooc === undefined && plotAuthorNeeded(store, payload.turn)) addLine('pacing', store.text('roleplay/plot-hint'))
    const filing = FILE_TOOLS.some(name => externalEnabled(store.settings().tools, 'gameMaster', name)) ? await deps.folders?.(owner.chat) : undefined
    const folderLine = filing === undefined ? undefined : foldersLine(filing, languageOf(store.settings().prompts.language) === 'zh' ? 'zh' : 'en')
    if (folderLine !== undefined) addLine('folders', folderLine)
    if (arrived.length > 0) addLine('messages', tr('While the player was away, these messages reached their character, who has read them: {messages}. Refer to them only if the player does.', { messages: arrived.map(message => `${message.name}: "${message.text}"`).join(' ') }))
    const rules = store.rules()
    if (rules.length > 0) addLine('rules', store.text('roleplay/rules', { rules: rules.map(rule => `- ${rule}`).join('\n') }))
    const wanted = ooc === undefined && dream === undefined ? parseRoll(text) : undefined
    if (wanted !== undefined) {
      try {
        const made = rollPlain(wanted.expression, deps.rolls?.roller(owner.chat))
        const roll = store.story.dice.record({ turn: payload.turn, expression: made.expression, faces: made.faces, kept: made.kept, modifier: made.modifier, total: made.total, value: made.total, reason: wanted.reason === '' ? tr('the player\'s roll') : wanted.reason, by: 'player' })
        addLine('roll', tr('The player rolled {dice} ({reason}) and got {total}: dice {faces}. This is a fact, decided by the dice: take it into account when you judge the attempt and decide what happens.', { dice: roll.expression, reason: roll.reason, total: roll.total, faces: `[${roll.faces.join(', ')}]` }))
      } catch (error) {
        engine.skip(owner)
        lines.push(store.text('roleplay/input-refused', { reason: error instanceof Error ? error.message : String(error) }))
      }
    }
    if (dream !== undefined) {
      const sleepers = store.sleepers(payload.turn)
      const wantedName = dream.who.toLowerCase()
      const found = wantedName === '' ? (sleepers.length === 1 ? sleepers : []) : sleepers.filter(entry => entry.key.toLowerCase() === wantedName || [entry.name, ...entry.aliases ?? []].some(name => name.toLowerCase().includes(wantedName)))
      const refusal = !store.settings().schedule.enabled ? tr('this chat keeps no days for its characters, so nobody sleeps and there is no dream to enter')
        : sleepers.length === 0 ? tr('nobody is asleep, so there is no dream to enter')
        : found.length === 0 ? tr('say whose dream: {names}', { names: sleepers.map(entry => entry.name).join(tr(', ')) })
        : found.length > 1 ? tr('more than one is asleep ({names}): say whose dream', { names: found.map(entry => entry.name).join(tr(', ')) })
        : undefined
      if (refusal !== undefined) { engine.skip(owner); lines.push(store.text('roleplay/input-refused', { reason: refusal })) }
      else {
        const sleeper = found[0]!
        engine.beginDream(owner, sleeper.key, tr('You are asleep and the player\'s character has come into your dream. Say what the dream holds.'))
        const report = await engine.dream(owner, characterRunner({ parent: payload.agent, boundaries, store }))
        const asked = report === undefined
          ? tr('Ask {name} (activate_characters with only {key}; the sleeper stays asleep and needs no wakes) what the dream holds, then narrate it.', { name: sleeper.name, key: sleeper.key })
          : tr('{name} has already been asked and answered from the dream: intent "{intent}"{said}. Ask nobody and call no tool but narrate, with narration segments only, and put what {name} says in the narration.', { name: sleeper.name, intent: report.intent, said: report.utterance === undefined || report.utterance === '' ? '' : tr(', said "{text}"', { text: report.utterance }) })
        addLine('dream', store.text('roleplay/dream', { name: sleeper.name, key: sleeper.key, asked }))
      }
    }
    const waiting = ooc === undefined && wanted === undefined && dream === undefined ? parseWait(text) : undefined
    if (waiting !== undefined) {
      const clock = store.settings().clock
      const refusal = clock.mode === 'real' ? tr('this chat follows the clock on the wall, so time cannot be skipped') : waiting.minutes === undefined ? tr('say how long, for example /wait 2 hours or /wait 30 minutes until the ferry') : waiting.minutes > clock.maxSkipDays * 1440 ? tr('that is more than the {days} days this chat allows in one skip', { days: clock.maxSkipDays }) : undefined
      if (refusal !== undefined) { engine.skip(owner); lines.push(store.text('roleplay/input-refused', { reason: refusal })) }
      else {
        const reason = waiting.reason === '' ? '' : ` (${waiting.reason})`
        const language = languageOf(store.settings().prompts.language) === 'zh' ? 'zh' : 'en'
        // the harness moves the time itself, so a wait never depends on the game master choosing advance_time; the game master narrates what the time held
        const skipped = (() => { try { return engine.advanceTime(owner, { byMinutes: waiting.minutes!, reason: waiting.reason === '' ? tr('time passes') : waiting.reason }) } catch { return undefined } })()
        if (skipped === undefined) addLine('wait', tr('The player lets {minutes} minutes pass{reason}. Move the story\'s time on by that much with advance_time, and let the world move meanwhile as it would: characters keep to their days, and you ask only those the time reaches. Stop sooner, at the moment it happens, if something comes up that the player must decide or could not sleep through, say what, and let the player act. Then narrate what the player perceived in the time that passed. You may play at most {rounds} rounds for this.', { minutes: waiting.minutes!, reason, rounds: store.settings().maxRounds }))
        else {
          const moved = skipped.moved.map(move => tr('{name} went to {place}.', { name: move.name, place: move.to })).join(' ')
          const happened = skipped.world.flatMap(entry => [...entry.events.map(text => `${entry.name}: ${text}`), ...entry.cues.map(cue => tr('{names} noticed: {text}', { names: cue.names.join(tr(' and ')), text: cue.text }))]).join(' ')
          addLine('wait', tr('The player let {minutes} minutes pass{reason}, and the story\'s time has already been moved on to {now}: do not call advance_time for it. {moved}{happened}Narrate what the player perceived in that time, in the story\'s own terms. If something in it would have made the player act or woken them, let it come at the end and stop there. You may play at most {rounds} rounds for this.', { minutes: waiting.minutes!, reason, now: describeInstant(skipped.to, skipped.zone, language), moved: moved === '' ? '' : `${moved} `, happened: happened === '' ? '' : `${happened} `, rounds: store.settings().maxRounds }))
        }
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
    store.recordTrace?.(payload.turn, { scene: sections, ...selection === undefined ? {} : { selected: selection } })
    return { ...decision, messages: [...decision.messages, notice(lines.join('\n\n'))] }
  })
}
