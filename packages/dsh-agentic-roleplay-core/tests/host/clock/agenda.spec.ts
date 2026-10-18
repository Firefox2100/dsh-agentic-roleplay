import { createSessionStore, HOUR, MINUTE, type SessionStore } from '@dsh-agentic-roleplay/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { agendaView, sceneAgenda } from '../../../src/host/clock/agenda.ts'
import { passRound, skipAhead, startTurn } from '../../../src/host/clock/passage.ts'
import type { ClockSettings } from '../../../src/host/clock/story-clock.ts'

const config: ClockSettings = { mode: 'simulated', timeZone: 'UTC', roundSeconds: 30, maxSkipDays: 30 }
const at = (day: number, hour: number, min = 0): number => Date.UTC(1912, 9, day, hour, min)
const wall = Date.UTC(2026, 0, 1)

let session: SessionStore
const id = (key: string): number => session.characters.getBySourceId(key)!.id
const placeOf = (key: string): string | undefined => session.locations.get(session.placements.get('character', id(key))?.locationId ?? 0)?.sourceId
const activityOf = (key: string): string => session.characterStates.get(id(key))?.activity ?? ''

/**
 * Arthur (the player), Clara and Eleanor in the bar; Marcus in the street. A day for Clara (the shop 09-17, the bar after,
 * sleeping at home), for Marcus (work in the street, home at night), none for Eleanor.
 */
beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, name, control] of [['arthur', 'Arthur', 'player'], ['clara', 'Clara', 'agent'], ['eleanor', 'Eleanor', 'agent'], ['marcus', 'Marcus', 'agent']] as const) {
    const { id: characterId } = session.characters.add({ ...base, sourceId, name, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(characterId, { publicState: '', innerState: '', activity: 'idle' })
  }
  session.edit({ turn: 1, places: ['bar', 'shop', 'home', 'street'].map(key => ({ key, name: key[0]!.toUpperCase() + key.slice(1) })), moves: [
    { character: 'arthur', to: 'bar', ignoreExits: true }, { character: 'clara', to: 'bar', ignoreExits: true }, { character: 'eleanor', to: 'bar', ignoreExits: true }, { character: 'marcus', to: 'street', ignoreExits: true },
  ] })
  const place = (key: string) => session.locations.getBySourceId(key)!.id
  session.routines.replace(id('clara'), [
    { days: [], start: 9 * 60, end: 17 * 60, activity: 'minds the shop', locationId: place('shop'), position: 'behind the counter', interruptible: false },
    { days: [], start: 17 * 60, end: 22 * 60, activity: 'drinks at the bar', locationId: place('bar'), interruptible: true },
    { days: [], start: 22 * 60, end: 9 * 60, activity: 'sleeps', locationId: place('home'), interruptible: true },
  ])
  session.routines.replace(id('marcus'), [{ days: [], start: 8 * 60, end: 18 * 60, activity: 'repairs the street lamps', locationId: place('street'), interruptible: true }, { days: [], start: 18 * 60, end: 8 * 60, activity: 'rests', locationId: place('home'), interruptible: true }])
  session.clock.start('simulated', at(4, 21, 40))
})

describe('catching the days up with the clock', () => {
  it('has those away from the player\'s scene go where their routine has them and take up what it has them doing', () => {
    startTurn(session, config, 1, wall)
    expect(placeOf('marcus')).toBe('home')
    expect(activityOf('marcus')).toBe('rests')
    const moves = skipAhead(session, config, 1, 1, wall, { untilTime: '10:00', reason: 'a night passes' })
    expect(moves.moved).toEqual([{ character: 'marcus', name: 'Marcus', to: 'Street', activity: 'repairs the street lamps' }])
    expect(placeOf('marcus')).toBe('street')
    expect(session.placements.get('character', id('marcus'))?.position).toBe('')
  })

  it('leaves those who are with the player where they are, and tells the game master what their day expects of them', () => {
    const turn = startTurn(session, config, 1, wall)
    expect(placeOf('clara')).toBe('bar')
    expect(turn.agenda.moved).toEqual([{ character: 'marcus', name: 'Marcus', to: 'Home', activity: 'rests' }])
    expect(turn.agenda.here).toEqual([{ name: 'Clara', note: '"drinks at the bar" is due to end soon' }])
    const late = skipAhead(session, config, 1, 1, wall, { untilTime: '22:30', reason: 'time passes' })
    expect(late.moved.map(move => move.character)).toEqual([])
    expect(sceneAgenda(session, 'UTC', at(4, 22, 30), []).here).toEqual([{ name: 'Clara', note: 'its day says "sleeps" at Home now, yet it is here' }])
  })

  it('does it once for each window: the character is not put back each turn, nor does it lose what it has since done', () => {
    startTurn(session, config, 1, wall)
    session.characterStates.update(id('marcus'), { activity: 'looks for the key' })
    session.edit({ turn: 1, moves: [{ character: 'marcus', to: 'shop', ignoreExits: true }] })
    expect(passRound(session, config, 1, 1, wall, 600).moved).toEqual([])
    expect([placeOf('marcus'), activityOf('marcus')]).toEqual(['shop', 'looks for the key'])
    expect(startTurn(session, config, 2, wall).agenda.moved).toEqual([])
  })

  it('does nothing for those with no day, nor for the player, nor when no window holds', () => {
    startTurn(session, config, 1, wall)
    skipAhead(session, config, 1, 1, wall, { byMinutes: 600, reason: 'x' })
    expect([placeOf('eleanor'), placeOf('arthur'), activityOf('eleanor')]).toEqual(['bar', 'bar', 'idle'])
    session.routines.replace(id('marcus'), [{ days: [1], start: 0, end: 60, activity: 'x', interruptible: true }])
    expect(skipAhead(session, config, 1, 2, wall, { byMinutes: 60, reason: 'x' }).moved).toEqual([])
  })

  it('has a character on the way for as long as the way takes, and there when it is over', () => {
    session.edit({ turn: 1, exits: [{ from: 'home', to: 'street', travelSeconds: 1200 }] })
    startTurn(session, config, 1, wall)
    expect(placeOf('marcus')).toBe('home')
    skipAhead(session, config, 1, 1, wall, { untilTime: '08:10', reason: 'a night passes' })
    expect(placeOf('marcus')).toBe('home')
    expect(activityOf('marcus')).toBe('on the way to Street, for "repairs the street lamps"')
    const moved = skipAhead(session, config, 1, 1, wall, { untilTime: '08:30', reason: 'time passes' })
    expect(placeOf('marcus')).toBe('street')
    expect(activityOf('marcus')).toBe('repairs the street lamps')
    expect(moved.moved.map(move => move.character)).toEqual(['marcus'])
  })

  it('does not hold a character back when no way is timed, and drops a journey when the day moves on', () => {
    session.edit({ turn: 1, exits: [{ from: 'home', to: 'street' }] })
    startTurn(session, config, 1, wall)
    skipAhead(session, config, 1, 1, wall, { untilTime: '08:05', reason: 'a night passes' })
    expect(placeOf('marcus')).toBe('street')
    session.edit({ turn: 1, exitChanges: [{ from: 'street', to: 'home', travelSeconds: 7200, oneWay: true }] })
    skipAhead(session, config, 1, 1, wall, { untilTime: '18:30', reason: 'a day passes' })
    expect(activityOf('marcus')).toContain('on the way to Home')
    skipAhead(session, config, 1, 1, wall, { untilTime: '07:00', reason: 'a night passes' })
    expect(placeOf('marcus')).toBe('home')
  })

  it('takes up a window with no place by what it has the character doing, without moving it', () => {
    session.routines.replace(id('marcus'), [{ days: [], start: 0, end: 1439, activity: 'keeps watch', interruptible: true }])
    startTurn(session, config, 1, wall)
    passRound(session, config, 1, 1, wall, 60)
    expect([placeOf('marcus'), activityOf('marcus')]).toEqual(['street', 'keeps watch'])
  })
})

describe('asking for a day to be made', () => {
  const asked = () => session.consolidation.pending().filter(item => item.kind === 'character').map(item => [item.kind, item.subjectId, item.note])

  it('is done once for a character who has none and was away while time passed, never for the player, a crowd, or someone with a day', () => {
    session.characters.add({ aliases: [], kind: 'group', tier: 'principal', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'crowd', name: 'Crowd', role: 'npc', control: 'agent' })
    session.edit({ turn: 1, moves: [{ character: 'crowd', to: 'street', ignoreExits: true }] })
    session.characters.add({ aliases: [], kind: 'person', tier: 'background', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'extra', name: 'Extra', role: 'npc', control: 'agent' })
    session.edit({ turn: 1, moves: [{ character: 'extra', to: 'street', ignoreExits: true }, { character: 'eleanor', to: 'street', ignoreExits: true }] })
    startTurn(session, config, 1, wall)
    expect(asked()).toEqual([])
    startTurn(session, { ...config, roundSeconds: 30 }, 2, wall + 1)
    skipAhead(session, config, 2, 0, wall, { byMinutes: 5, reason: 'x' })
    expect(asked()).toEqual([['character', id('eleanor'), expect.stringMatching(/^has no routine: give it a day/)]])
    skipAhead(session, config, 2, 0, wall, { byMinutes: 5, reason: 'x' })
    expect(asked()).toHaveLength(1)
  })

  it('is not done while the character is with the player, nor by a round, nor without places', () => {
    startTurn(session, config, 1, wall)
    passRound(session, config, 1, 1, wall, 600)
    expect(asked()).toEqual([])
    const other = createSessionStore(':memory:', { id: 's2', name: 'S', world: { id: 'w', name: 'W' } })
    other.characters.add({ aliases: [], kind: 'person', tier: 'principal', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'a', name: 'A', role: 'npc', control: 'agent' })
    other.clock.start('simulated', at(4, 21))
    startTurn(other, config, 1, wall)
    skipAhead(other, config, 1, 0, wall, { byMinutes: 5, reason: 'x' })
    expect(other.consolidation.pending()).toEqual([])
  })

  it('is at most a few at a time', () => {
    const base = { aliases: [], kind: 'person' as const, tier: 'supporting' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      session.characters.add({ ...base, sourceId: key, name: key.toUpperCase(), role: 'npc', control: 'agent' })
      session.edit({ turn: 1, moves: [{ character: key, to: 'street', ignoreExits: true }] })
    }
    startTurn(session, config, 1, wall)
    skipAhead(session, config, 1, 0, wall, { byMinutes: 5, reason: 'x' })
    expect(asked()).toHaveLength(3)
    skipAhead(session, config, 1, 0, wall, { byMinutes: 5, reason: 'x' })
    expect(asked()).toHaveLength(5)
  })
})

describe('what the characters and the game master are told', () => {
  it('is a character\'s own day: what it is doing and until when, what comes next, what it is due to do, and what it is after', () => {
    session.engagements.add({ title: 'Meet Marcus at the bar', at: at(4, 22), locationId: session.locations.getBySourceId('bar')!.id, participants: [id('clara'), id('marcus')], turn: 1 })
    session.engagements.add({ title: 'Return the key', at: at(4, 20), participants: [id('clara')], turn: 1 })
    session.intents.add(id('clara'), { type: 'obligation', name: 'Find the ledger', description: 'Promised Bob. Urgent.', status: 'active', horizon: 'day', priority: 0.8, urgency: 0.9, plan: ['Search the shop', 'Ask Marcus', 'Ask Eleanor', 'Give up', 'More'], openThreads: [], constraints: [], deadline: new Date(at(5, 9)).toISOString() })
    const view = agendaView(session, id('clara'), 'UTC', at(4, 21, 40))
    expect(view.now).toEqual({ activity: 'drinks at the bar', place: 'Bar', until: at(4, 22), interruptible: true })
    expect(view.next).toEqual({ activity: 'sleeps', place: 'Home', at: at(4, 22) })
    expect(view.engagements).toEqual([
      { title: 'Return the key', at: at(4, 20), with: [], overdue: true },
      { title: 'Meet Marcus at the bar', at: at(4, 22), place: 'Bar', with: ['Marcus'], overdue: false },
    ])
    expect(view.goals).toEqual([{ name: 'Find the ledger', type: 'obligation', description: 'Promised Bob. Urgent.', plan: ['Search the shop', 'Ask Marcus', 'Ask Eleanor'], deadline: at(5, 9), overdue: false }])
  })

  it('is, for the game master, those with the player whose day expects them elsewhere or whose window ends soon, and commitments due soon or overdue, and nothing else', () => {
    const note = (hour: number, min: number) => sceneAgenda(session, 'UTC', at(4, hour, min), [])
    expect(note(21, 0).here).toEqual([])
    expect(note(21, 40).here).toEqual([{ name: 'Clara', note: '"drinks at the bar" is due to end soon' }])
    expect(note(16, 40).here).toEqual([{ name: 'Clara', note: 'its day says "minds the shop" at Shop now, yet it is here' }])
    session.engagements.add({ title: 'Soon', at: at(4, 22), participants: [id('marcus')], turn: 1 })
    session.engagements.add({ title: 'Later', at: at(5, 22), participants: [id('marcus')], turn: 1 })
    session.engagements.add({ title: 'Long gone', at: at(1, 22), participants: [id('marcus')], turn: 1 })
    session.engagements.add({ title: 'Just missed', at: at(4, 21), participants: [id('marcus'), id('arthur')], turn: 1 })
    expect(note(21, 40).engagements.map(entry => [entry.title, entry.overdue, entry.with])).toEqual([['Just missed', true, ['Arthur', 'Marcus']], ['Soon', false, ['Marcus']]])
    expect(note(21, 40).moved).toEqual([])
  })
})

it('keeps the bounds in sight: an hour is sixty of them', () => {
  expect(HOUR / MINUTE).toBe(60)
})
