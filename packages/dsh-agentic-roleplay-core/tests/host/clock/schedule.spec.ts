import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { agendaView, holdCharacter, isHeld, sceneAgenda, sleepersNow, sleepingNow } from '../../../src/host/clock/agenda.ts'
import { passRound, skipAhead, startTurn } from '../../../src/host/clock/passage.ts'
import type { ClockSettings } from '../../../src/host/clock/story-clock.ts'

const config: ClockSettings = { mode: 'simulated', timeZone: 'UTC', roundSeconds: 30, maxSkipDays: 30 }
const at = (day: number, hour: number, min = 0): number => Date.UTC(1912, 9, day, hour, min)
const wall = Date.UTC(2026, 0, 1)

let session: SessionStore
const id = (key: string): number => session.characters.getBySourceId(key)!.id
const placeOf = (key: string): string | undefined => session.locations.get(session.placements.get('character', id(key))?.locationId ?? 0)?.sourceId
const activityOf = (key: string): string => session.characterStates.get(id(key))?.activity ?? ''

/** Arthur (the player, who also has a night's sleep in his files), Clara and Marcus, each with a day that has a window of sleep at home; the story starts at 21:40 with Arthur in the library and everyone else away. */
beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, name, control] of [['arthur', 'Arthur', 'player'], ['clara', 'Clara', 'agent'], ['marcus', 'Marcus', 'agent']] as const) {
    const { id: characterId } = session.characters.add({ ...base, sourceId, name, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(characterId, { publicState: '', innerState: '', activity: 'idle' })
  }
  session.edit({ turn: 1, places: ['bar', 'library', 'home', 'street'].map(key => ({ key, name: key[0]!.toUpperCase() + key.slice(1) })), moves: [
    { character: 'arthur', to: 'library', ignoreExits: true }, { character: 'clara', to: 'street', ignoreExits: true }, { character: 'marcus', to: 'street', ignoreExits: true },
  ] })
  const place = (key: string) => session.locations.getBySourceId(key)!.id
  const day = [
    { days: [], start: 8 * 60, end: 12 * 60, activity: 'works', locationId: place('street'), interruptible: true },
    { days: [], start: 12 * 60, end: 22 * 60, activity: 'drinks at the bar', locationId: place('bar'), interruptible: true },
    { days: [], start: 22 * 60, end: 8 * 60, activity: 'sleeps', locationId: place('home'), interruptible: true, sleep: true },
  ]
  for (const key of ['arthur', 'clara', 'marcus']) session.routines.replace(id(key), day)
  session.clock.start('simulated', at(4, 21, 40))
})

describe('sleep in a day', () => {
  it('has a character asleep in the place it sleeps in, while its window of sleep lasts', () => {
    startTurn(session, config, 1, wall)
    expect(sleepingNow(session, id('marcus'), 'UTC', at(4, 21, 59))).toBeUndefined()
    skipAhead(session, config, 1, 1, wall, { untilTime: '23:00', reason: 'time passes' })
    expect(placeOf('marcus')).toBe('home')
    expect(activityOf('marcus')).toBe('sleeps')
    expect(sleepingNow(session, id('marcus'), 'UTC', at(4, 23))).toEqual({ until: at(5, 8) })
    expect(sleepersNow(session, 'UTC', at(4, 23)).map(entry => entry.key).sort()).toEqual(['clara', 'marcus'])
  })

  it('is never the player\'s: the avatar has no day to sleep through', () => {
    expect(sleepingNow(session, id('arthur'), 'UTC', at(4, 23))).toBeUndefined()
    expect(startTurn(session, config, 1, wall).agenda.moved.map(move => move.character)).not.toContain('arthur')
    expect(agendaView(session, id('arthur'), 'UTC', at(4, 23)).now).toBeUndefined()
    expect(sceneAgenda(session, 'UTC', at(4, 23), []).asleep.map(entry => entry.key)).not.toContain('arthur')
  })

  it('is not asleep away from its bed: a character somewhere else is only awake', () => {
    expect(sleepingNow(session, id('marcus'), 'UTC', at(4, 23))).toBeUndefined()
  })

  it('tells the game master who is asleep, wherever they are', () => {
    startTurn(session, config, 1, wall)
    skipAhead(session, config, 1, 1, wall, { untilTime: '23:00', reason: 'time passes' })
    expect(sceneAgenda(session, 'UTC', at(4, 23), []).asleep).toEqual([{ key: 'clara', name: 'Clara', until: at(5, 8) }, { key: 'marcus', name: 'Marcus', until: at(5, 8) }])
  })

  it('knows no one asleep when the chat keeps no days', () => {
    expect(startTurn(session, config, 1, wall, false).agenda).toMatchObject({ moved: [], asleep: [], here: [] })
    expect(placeOf('marcus')).toBe('street')
    expect(agendaView(session, id('marcus'), 'UTC', at(4, 21, 40), false)).toMatchObject({ engagements: [], goals: [] })
    expect(agendaView(session, id('marcus'), 'UTC', at(4, 21, 40), false).now).toBeUndefined()
  })
})

describe('what the story makes of a character against its day', () => {
  it('keeps the routine from pulling a character who was led elsewhere, until its day next changes, and then takes it up', () => {
    startTurn(session, config, 1, wall)
    expect(placeOf('marcus')).toBe('bar')
    session.edit({ turn: 1, moves: [{ character: 'marcus', to: 'street', ignoreExits: true }] })
    session.characterStates.update(id('marcus'), { activity: 'shows Arthur the lamps' })
    holdCharacter(session, id('marcus'), 'UTC', at(4, 21, 40))
    expect(isHeld(session, id('marcus'), at(4, 21, 50))).toBe(true)
    expect(agendaView(session, id('marcus'), 'UTC', at(4, 21, 50))).toMatchObject({ offDay: { until: at(4, 22) } })
    expect(agendaView(session, id('marcus'), 'UTC', at(4, 21, 50)).now).toBeUndefined()
    passRound(session, config, 1, 1, wall, 5 * 60)
    expect([placeOf('marcus'), activityOf('marcus')]).toEqual(['street', 'shows Arthur the lamps'])
    const later = skipAhead(session, config, 1, 2, wall, { untilTime: '22:30', reason: 'time passes' })
    expect(later.moved.map(move => move.character)).toContain('marcus')
    expect([placeOf('marcus'), activityOf('marcus')]).toEqual(['home', 'sleeps'])
    expect(isHeld(session, id('marcus'), at(4, 22, 30))).toBe(false)
  })

  it('keeps a character waiting for the player past its whole night, and lets it go when the player is with it again', () => {
    startTurn(session, config, 1, wall)
    session.edit({ turn: 1, moves: [{ character: 'marcus', to: 'street', ignoreExits: true }] })
    holdCharacter(session, id('marcus'), 'UTC', at(4, 21, 40), undefined, true)
    skipAhead(session, config, 1, 1, wall, { untilTime: '23:30', reason: 'time passes' })
    skipAhead(session, config, 1, 2, wall, { untilTime: '07:00', reason: 'time passes' })
    expect(placeOf('marcus')).toBe('street')
    expect(isHeld(session, id('marcus'), at(5, 7))).toBe(true)
    session.edit({ turn: 1, moves: [{ character: 'arthur', to: 'street', ignoreExits: true }] })
    skipAhead(session, config, 1, 3, wall, { untilTime: '07:30', reason: 'time passes' })
    expect(isHeld(session, id('marcus'), at(5, 7, 30))).toBe(false)
    expect(placeOf('marcus')).toBe('street')
  })

  it('lets a character waiting for the player go after a day', () => {
    startTurn(session, config, 1, wall)
    session.edit({ turn: 1, moves: [{ character: 'marcus', to: 'street', ignoreExits: true }] })
    expect(holdCharacter(session, id('marcus'), 'UTC', at(4, 21, 40), undefined, true)).toBe(at(5, 21, 40))
    expect(isHeld(session, id('marcus'), at(5, 21))).toBe(true)
    expect(isHeld(session, id('marcus'), at(5, 22))).toBe(false)
  })

  it('holds for the minutes it is told', () => {
    startTurn(session, config, 1, wall)
    expect(holdCharacter(session, id('marcus'), 'UTC', at(4, 21, 40), 180)).toBe(at(5, 0, 40))
    skipAhead(session, config, 1, 1, wall, { untilTime: '23:30', reason: 'time passes' })
    expect(placeOf('marcus')).toBe('bar')
    skipAhead(session, config, 1, 2, wall, { untilTime: '01:00', reason: 'time passes' })
    expect(placeOf('marcus')).toBe('home')
  })

  it('wakes a sleeper for the rest of its night: awake until the sleep window ends, then its day goes on', () => {
    startTurn(session, config, 1, wall)
    skipAhead(session, config, 1, 1, wall, { untilTime: '23:00', reason: 'time passes' })
    expect(sleepingNow(session, id('marcus'), 'UTC', at(4, 23))).toBeDefined()
    expect(holdCharacter(session, id('marcus'), 'UTC', at(4, 23))).toBe(at(5, 8))
    expect(sleepingNow(session, id('marcus'), 'UTC', at(4, 23, 10))).toBeUndefined()
    expect(sleepersNow(session, 'UTC', at(4, 23, 10)).map(entry => entry.key)).toEqual(['clara'])
    skipAhead(session, config, 1, 2, wall, { untilTime: '09:00', reason: 'morning' })
    expect([placeOf('marcus'), activityOf('marcus')]).toEqual(['street', 'works'])
  })

  it('does not tell the game master that a held character\'s day expects it elsewhere', () => {
    session.edit({ turn: 1, moves: [{ character: 'marcus', to: 'library', ignoreExits: true }] })
    expect(sceneAgenda(session, 'UTC', at(4, 21, 40), []).here.map(entry => entry.name)).toContain('Marcus')
    holdCharacter(session, id('marcus'), 'UTC', at(4, 21, 40))
    expect(sceneAgenda(session, 'UTC', at(4, 21, 40), []).here.map(entry => entry.name)).not.toContain('Marcus')
  })
})
