import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { describeDuration, type Session } from '@dsh-agentic-roleplay/state'
import { INTENT_STATUSES, type Faction } from 'dsh-roleplay-model'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { Strategist, StrategyJob, TurnStore } from '../orchestration/boundaries.ts'
import { describeWhen } from '../clock/story-clock.ts'

const LAST_KEY = 'strategy.last'
const DAY_MS = 24 * 60 * 60 * 1000
/** Rounds numbered from here belong to what organisations did, as off-stage rounds have their own range. */
const STRATEGY_ROUND = 200
const MAX_ACTIVE_GOALS = 8
const MAX_TEXT = 400
/** What a decision may hold: the summary, both states, a new goal with its plan, and the status of each active goal. */
const DECISION_LIMITS = [MAX_TEXT, MAX_TEXT, MAX_TEXT, 120, MAX_TEXT, ...Array.from({ length: 6 }, () => 200), ...Array.from({ length: MAX_ACTIVE_GOALS }, () => 10)]

type StrategySession = Pick<Session, 'factions' | 'factionStates' | 'factionIntents' | 'factionMemberships' | 'factionRelationships' | 'characters' | 'events' | 'metadata' | 'edit' | 'transaction'>

const keyOf = (faction: Pick<Faction, 'id' | 'sourceId'>): string => faction.sourceId ?? String(faction.id)

function lastActed(session: Pick<Session, 'metadata'>): Record<string, number> {
  const stored = session.metadata.getValue(LAST_KEY)
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}
}

/**
 * The organisations whose time has come: they have a goal in hand, and `everyDays` of story time have passed since they last decided.
 * One seen for the first time starts its clock now and is not due yet. Longest waiting first.
 */
export function dueFactions(session: StrategySession, now: number, everyDays: number): Faction[] {
  const last = lastActed(session)
  const due: { faction: Faction; since: number }[] = []
  for (const faction of session.factions.list()) {
    const key = keyOf(faction)
    if (last[key] === undefined) { last[key] = now; continue }
    if (now - last[key]! < everyDays * DAY_MS) continue
    if (session.factionIntents.list(faction.id, { status: 'active' }).length === 0) continue
    due.push({ faction, since: last[key]! })
  }
  session.metadata.setValue(LAST_KEY, last)
  return due.sort((a, b) => a.since - b.since).map(entry => entry.faction)
}

function markActed(session: Pick<Session, 'metadata'>, faction: Faction, now: number): void {
  session.metadata.setValue(LAST_KEY, { ...lastActed(session), [keyOf(faction)]: now })
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One concrete thing the organisation does in this time, in the past tense, in one or two sentences; or that it waits, and why.' },
    public_state: { type: 'string', description: 'Its public state afterwards, only when outsiders could see it change.' },
    inner_state: { type: 'string', description: 'Its private state afterwards, only when its inner position moved.' },
    goal_updates: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer', description: 'The number of the goal, as listed.' }, status: { type: 'string', enum: [...INTENT_STATUSES] } }, required: ['id', 'status'], additionalProperties: false },
      description: 'Goals whose status changed.',
    },
    new_goal: {
      type: 'object',
      properties: { name: { type: 'string' }, description: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } } },
      required: ['name', 'description', 'plan'],
      additionalProperties: false,
      description: 'At most one new goal, when the situation calls for it.',
    },
  },
  required: ['summary'],
  additionalProperties: false,
}

export interface Strategy {
  summary: string
  public_state?: string
  inner_state?: string
  goal_updates?: { id: number; status: (typeof INTENT_STATUSES)[number] }[]
  new_goal?: { name: string; description: string; plan: string[] }
}

function brief(session: StrategySession, faction: Faction, now: number, zone: string, since: number): string {
  const state = session.factionStates.get(faction.id)
  const named = (id: number): string => session.characters.get(id)?.name ?? String(id)
  const goals = session.factionIntents.list(faction.id, { status: 'active' })
  const members = session.factionMemberships.ofFaction(faction.id, 'active').map(member => `${named(member.characterId)} (${[member.role, member.rank].filter(part => part !== '').join(', ') || 'member'})`)
  const standing = session.factionRelationships.from('faction', faction.id).map((relation) => {
    const target = relation.toKind === 'faction' ? session.factions.get(relation.toId)?.name : named(relation.toId)
    return `${target ?? relation.toId}: ${relation.label}${relation.summary === '' ? '' : ` - ${relation.summary}`}`
  })
  const events = session.events.list().slice(-8).map(event => `- ${event.text}`)
  return [
    `Organisation: ${faction.name}${faction.summary === '' ? '' : ` - ${faction.summary}`}`,
    faction.description === '' ? '' : `About it: ${faction.description}`,
    faction.values.length === 0 ? '' : `Values: ${faction.values.join('; ')}`,
    faction.structure === '' ? '' : `Structure: ${faction.structure}`,
    `Public state: ${state?.publicState || '(nothing stated)'}`,
    `Private state: ${state?.innerState || '(nothing stated)'}`,
    'Goals in hand:',
    ...goals.map(goal => `- ${goal.id}. ${goal.name} (${goal.type}): ${goal.description}${goal.plan.length === 0 ? '' : ` Next: ${goal.plan.join('; ')}.`}${goal.deadline === undefined ? '' : ` By ${goal.deadline}.`}`),
    members.length === 0 ? '' : `Members: ${members.join('; ')}`,
    standing.length === 0 ? '' : `Its standing with others:\n${standing.map(line => `- ${line}`).join('\n')}`,
    `It is ${describeWhen(now, now, zone)} now; the organisation last decided ${describeDuration(now - since)} ago.`,
    events.length === 0 ? '' : `What has happened lately:\n${events.join('\n')}`,
    'Decide what the organisation does.',
  ].filter(line => line !== '').join('\n')
}

export function applyStrategy(job: Pick<StrategyJob, 'turn'>, session: StrategySession, faction: Faction, strategy: Strategy, now: number): void {
  const active = session.factionIntents.list(faction.id, { status: 'active' })
  session.transaction(() => {
    if (strategy.public_state !== undefined || strategy.inner_state !== undefined) {
      session.factionStates.update(faction.id, { ...(strategy.public_state === undefined ? {} : { publicState: strategy.public_state.slice(0, MAX_TEXT) }), ...(strategy.inner_state === undefined ? {} : { innerState: strategy.inner_state.slice(0, MAX_TEXT) }) })
    }
    for (const update of strategy.goal_updates ?? []) {
      if (active.some(goal => goal.id === update.id)) session.factionIntents.update(update.id, { status: update.status })
    }
    const goal = strategy.new_goal
    const room = MAX_ACTIVE_GOALS - session.factionIntents.list(faction.id, { status: 'active' }).length
    if (goal !== undefined && goal.name.trim() !== '' && room > 0) {
      session.factionIntents.add(faction.id, { type: 'agenda', name: goal.name.trim().slice(0, 120), description: goal.description.slice(0, MAX_TEXT), status: 'active', horizon: 'short', priority: 0.5, urgency: 0.4, plan: goal.plan.slice(0, 6).map(step => step.slice(0, 200)), openThreads: [], constraints: [] })
    }
    // Known to no character: a faction's own business is ground truth until someone is told.
    session.edit({ turn: job.turn, events: [{ turn: job.turn, round: STRATEGY_ROUND, text: `${faction.name}: ${strategy.summary.slice(0, MAX_TEXT)}`, importance: 3, tags: ['faction', faction.name], involves: [], perceivedBy: [] }] }, { seal: true })
  })
  markActed(session, faction, now)
}

/**
 * Has organisations decide, one request each and one after another, what they do as story time passes. They are bounded by the chat
 * (`factions.perTurn`, one decision per `factions.everyDays` of story time each), and a failure leaves the organisation as it was.
 */
export function factionStrategist(deps: { agentOf: (chat: string) => Agent | undefined }): Strategist {
  return {
    async strategize(job, signal) {
      const { perTurn, everyDays } = job.store.settings().factions
      const acted: { faction: string; summary: string }[] = []
      if (perTurn === 0) return { acted }
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const session: StrategySession = job.store.story
      const { now, zone } = job.store.time(job.turn)
      const last = lastActed(session)
      for (const faction of dueFactions(session, now, everyDays).slice(0, perTurn)) {
        const store: TurnStore = job.store
        const strategy = await runChild<Strategy>({
          parent, signal, reasoningEffort: store.settings().reasoning.children, sampling: childSampling(store.settings(), 'authoring', estimateAnswer(DECISION_LIMITS, store.settings().prompts.language)), ...childModel(store.settings(), 'authoring'), trace: childTrace(store, 'authoring', `faction ${faction.name}`),
          persona: promptFor(parent, 'roleplay/faction-strategist', store.settings().prompts.language),
          prompt: brief(session, faction, now, zone, last[keyOf(faction)] ?? now),
          result: RESULT,
          maxCalls: 3,
        })
        applyStrategy(job, session, faction, strategy, now)
        acted.push({ faction: faction.name, summary: strategy.summary })
      }
      return { acted }
    },
  }
}
