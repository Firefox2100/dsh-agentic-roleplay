import type { Agent } from '@deepseek-ai/dsh-agent'
import { describeDuration, describeInstant, seededRoll } from '@dsh-agentic-roleplay/state'
import { translator } from 'dsh-roleplay-model'
import type { DecisionService } from '@dsh-ai-providers/core'
import { askExtra, noteExtra } from '../decisions/extras.ts'
import { languageOf } from '../prompts/library.ts'
import { wrongLanguage } from '../translate/language.ts'
import type { Boundaries, CastMember, TurnStore } from './boundaries.ts'
import { characterRunner } from './character-runner.ts'
import type { TurnEngine } from './turn-engine.ts'

/** The longest message a character leaves: it is a note beside the story, not a scene. */
const MAX_MESSAGE_CHARS = 500
/** The share of the chance that grows with how long the player has been away: the full share is reached after this many hours. */
const FULL_AFTER_HOURS = 12
const MINUTE = 60_000

export interface AutonomyDeps {
  engine: TurnEngine
  stores: (chat: string) => TurnStore | undefined
  boundaries: () => Boundaries
  agentOf: (chat: string) => Agent | undefined
  wall: () => number
  problem: (message: string) => void
  /** A number in [0, 1) that is the same for the same key: the draw of whether a character writes now. */
  draw?: (key: string) => number
  /** The decision model, when there is one: asked whether a character picked by chance has a reason to write. */
  decisions?: () => DecisionService | undefined
}

const seenProblems = new Map<string, string>()

export type AutonomyOutcome = 'off' | 'busy' | 'recent' | 'away' | 'limit' | 'nobody' | 'idle' | 'declined' | 'quiet' | 'wrote'

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** Whether a character could write to the player now: a person who knows the player, is awake, is not with them, and has not been asked lately. Higher is likelier. */
export function writingChance(store: TurnStore, member: CastMember, player: CastMember, turn: number, idleMs: number): number | undefined {
  const { character } = member
  if (character.control !== 'agent' || character.kind !== 'person' || character.tier === 'background') return undefined
  if (member.place !== undefined && member.place.location.id === player.place?.location.id) return undefined
  if (store.agenda(turn, character.id).now?.interruptible === false) return undefined
  if (store.asleep(turn, character.id) !== undefined) return undefined
  const relation = store.story.relationships.get(character.id, player.character.id)
  if (relation === undefined) return undefined
  return clamp(0.15 + 0.35 * clamp(relation.affinity, 0, 1) + 0.2 * Math.min(1, idleMs / (FULL_AFTER_HOURS * 60 * MINUTE)), 0, 0.9)
}

/**
 * What the story does by itself while the player is away, once: the days of the characters are taken up to the real time (no model request), and, within
 * the limits of the chat, one character who is awake and knows the player may write to them. Nothing runs for a chat that has not switched it on, that
 * is not on the real clock, whose turn is being played, or that has done `maxUnanswered` things with no message from the player in between.
 */
export async function tickAutonomy(deps: AutonomyDeps, chat: string, signal: AbortSignal): Promise<{ outcome: AutonomyOutcome; moved: number; message?: string }> {
  const store = deps.stores(chat)
  const autonomy = store?.autonomy
  if (store === undefined || autonomy === undefined) return { outcome: 'off', moved: 0 }
  const settings = store.settings()
  if (!settings.autonomy.enabled || settings.clock.mode !== 'real') return { outcome: 'off', moved: 0 }
  if (deps.engine.playing(chat)) return { outcome: 'busy', moved: 0 }
  const turn = store.story.metadata.get().turns
  const moved = autonomy.catchUp(turn).length
  const shifted = autonomy.shifts()
  if (!settings.autonomy.messages) return { outcome: 'quiet', moved }
  const config = settings.autonomy
  const now = deps.wall()
  const state = autonomy.state()
  const last = autonomy.lastPlayerAt()
  if (state.unanswered >= config.maxUnanswered) return { outcome: 'limit', moved }
  if (last === undefined || now - last < config.idleMinutes * MINUTE) return { outcome: 'recent', moved }
  if (now - last > config.awayHours * 60 * MINUTE) return { outcome: 'away', moved }
  const cast = store.cast()
  const player = cast.find(member => member.character.control === 'player')
  if (player === undefined) return { outcome: 'nobody', moved }
  const draw = deps.draw ?? seededRoll
  const gap = config.messageGapMinutes * MINUTE
  const eligible = cast.flatMap((member) => {
    if (now - (state.sent[member.key] ?? 0) < gap) return []
    const chance = writingChance(store, member, player, turn, now - last)
    return chance === undefined ? [] : [{ member, chance }]
  })
  if (eligible.length === 0) return { outcome: 'nobody', moved }
  // Two ways to a message: a draw for the story at each look, that gets rarer with every message sent without a reply, and a character whose day just changed.
  const transition = eligible.filter(entry => shifted.includes(entry.member.key) && draw(`${chat}:${entry.member.key}:shift:${now}`) < config.transitionChance)
  const random = draw(`${chat}:look:${now}`) < config.chance * config.decay ** state.unanswered
  if (!random && transition.length === 0) return { outcome: 'idle', moved }
  const pool = transition.length > 0 ? transition : eligible
  const total = pool.reduce((sum, entry) => sum + entry.chance, 0)
  let pick = draw(`${chat}:pick:${now}`) * total
  const chosen = pool.find((entry) => { pick -= entry.chance; return pick < 0 }) ?? pool[pool.length - 1]!
  const speaker = chosen.member
  const because = transition.some(entry => entry.member === speaker)
  if (settings.decisions.messages === 'on') {
    const time = store.time(turn)
    const asks = [{ key: 'write', instructions: store.text('roleplay/decide-message', {}) }]
    const facts = { character: speaker.character.name, doing: store.agenda(turn, speaker.character.id).now?.activity ?? speaker.character.name, day_just_changed: because, hours_the_player_has_been_away: Math.round((now - last) / (60 * MINUTE) * 10) / 10, unanswered_messages: state.unanswered, time_of_day: describeInstant(time.now, time.zone) }
    const { found, report } = await askExtra(deps.decisions?.(), facts, asks, settings.decisions.gateThreshold, signal)
    noteExtra('messages', chat, store, report, seenProblems, deps.problem)
    // a decision model that could not be asked leaves it to chance
    if (report.problem === undefined && found.length === 0) return { outcome: 'declined', moved }
  }
  const parent = deps.agentOf(chat)
  if (parent === undefined) return { outcome: 'off', moved }
  const language = languageOf(settings.prompts.language) === 'zh' ? 'zh' : 'en'
  const tr = translator(language)
  const time = store.time(turn)
  const situation = [
    tr('The player\'s character has not been with you for {away}, and you are not with them now. It is {now} for you.', { away: describeDuration(now - last, language), now: describeInstant(time.now, time.zone, language) }),
    tr('You may write them a short message, in your own voice, as someone who knows them would: what you are doing, what is on your mind, something you want them to know or do. Say it in the utterance, in a line or two, with nothing around it.'),
    because ? tr('Something in your own day has just changed, and it may have made you think of them.') : '',
    state.unanswered > 0 ? tr('You and others have already written to them since they were last here and they have not answered: do not press, and never complain about it.') : '',
    tr('If nothing makes you want to write now, answer with commitment low and no utterance.'),
  ].filter(line => line !== '').join(' ')
  const run = characterRunner({ parent, boundaries: deps.boundaries, store })
  const report = await deps.engine.askAlone({ chat, turn }, speaker.key, situation, run, signal)
  const text = report?.utterance?.trim().replace(/^["“「]|["”」]$/g, '').trim()
  if (report === undefined || report.commitment === 'low' || text === undefined || text === '' || text.length > MAX_MESSAGE_CHARS || wrongLanguage(language, { message: text }, { strays: true }) !== undefined) {
    autonomy.asked(speaker.key, now)
    return { outcome: 'quiet', moved }
  }
  autonomy.said(turn, { at: now, character: speaker.key, name: speaker.character.name, text })
  return { outcome: 'wrote', moved, message: text }
}
