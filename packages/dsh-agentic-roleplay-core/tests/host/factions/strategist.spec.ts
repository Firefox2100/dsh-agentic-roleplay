import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyStrategy, dueFactions } from '../../../src/host/factions/strategist.ts'

const DAY = 24 * 60 * 60 * 1000
let session: SessionStore
let guild: number
let idle: number

const goal = (name: string) => ({ type: 'agenda' as const, name, description: `${name}.`, status: 'active' as const, horizon: 'short' as const, priority: 0.6, urgency: 0.4, plan: ['first step'], openThreads: [], constraints: [] })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'strategy', name: 'Strategy', world: { id: 'w', name: 'W' } })
  const make = (sourceId: string, name: string) => {
    const faction = session.factions.add({ sourceId, name, aliases: [], summary: `${name} of the town.`, description: '', values: ['order'], structure: '' })
    session.factionStates.create(faction.id, { publicState: 'Quiet.', innerState: 'Divided.' })
    return faction.id
  }
  guild = make('guild', 'The Guild')
  idle = make('idle', 'The Idle Club')
  session.factionIntents.add(guild, goal('Control the market'))
})
afterEach(() => { session.close() })

describe('which organisations are due', () => {
  it('start their clock when first seen and are not due until the days have passed, and only with a goal in hand', () => {
    expect(dueFactions(session, 10 * DAY, 3)).toEqual([])
    expect(dueFactions(session, 11 * DAY, 3)).toEqual([])
    expect(dueFactions(session, 13 * DAY, 3).map(faction => faction.name)).toEqual(['The Guild'])
    expect(session.factionIntents.list(idle, { status: 'active' })).toEqual([])
  })

  it('leave the longest waiting first', () => {
    session.factionIntents.add(idle, goal('Keep the peace'))
    session.metadata.setValue('strategy.last', { guild: 5 * DAY, idle: 2 * DAY })
    expect(dueFactions(session, 20 * DAY, 3).map(faction => faction.name)).toEqual(['The Idle Club', 'The Guild'])
  })
})

describe('what an organisation decides', () => {
  const strategy = { summary: 'The Guild buys up the stalls on market day.', public_state: 'Openly flush.', inner_state: 'Sure of itself.', goal_updates: [{ id: 0, status: 'completed' as const }], new_goal: { name: 'Win the mayor over', description: 'Make the mayor an ally.', plan: ['Invite the mayor to dinner'] } }

  it('changes its states and goals, adds one new goal, records a deed known to no one, and starts its clock again', () => {
    const first = session.factionIntents.list(guild, { status: 'active' })[0]!
    applyStrategy({ turn: 4 }, session, session.factions.get(guild)!, { ...strategy, goal_updates: [{ id: first.id, status: 'completed' }] }, 30 * DAY)
    expect(session.factionStates.get(guild)).toMatchObject({ publicState: 'Openly flush.', innerState: 'Sure of itself.' })
    expect(session.factionIntents.get(first.id)?.status).toBe('completed')
    expect(session.factionIntents.list(guild, { status: 'active' }).map(entry => entry.name)).toEqual(['Win the mayor over'])
    const event = session.events.list().at(-1)!
    expect(event).toMatchObject({ text: 'The Guild: The Guild buys up the stalls on market day.', sealed: true })
    expect(session.events.perceptionsOf(event.id)).toEqual([])
    expect(dueFactions(session, 31 * DAY, 3)).toEqual([])
  })

  it('ignores a goal that is not one of its active ones, and keeps what it left unsaid', () => {
    applyStrategy({ turn: 4 }, session, session.factions.get(guild)!, { summary: 'The Guild waits.', goal_updates: [{ id: 9999, status: 'failed' }] }, 30 * DAY)
    expect(session.factionStates.get(guild)).toMatchObject({ publicState: 'Quiet.', innerState: 'Divided.' })
    expect(session.factionIntents.list(guild, { status: 'active' })).toHaveLength(1)
  })

  it('does not pile up goals past the limit', () => {
    for (let n = 0; n < 8; n += 1) session.factionIntents.add(guild, goal(`Extra ${n}`))
    applyStrategy({ turn: 4 }, session, session.factions.get(guild)!, { summary: 'The Guild plans.', new_goal: { name: 'One too many', description: 'x', plan: [] } }, 30 * DAY)
    expect(session.factionIntents.list(guild, { status: 'active' }).some(entry => entry.name === 'One too many')).toBe(false)
  })
})
