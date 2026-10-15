import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { readInterventions } from '../../../src/host/sessions/interventions.ts'
import { readWithdrawn } from '../../../src/host/triggers/deliver.ts'
import { fireTriggers, noteStore } from '../../../src/host/triggers/notes.ts'

const NOON = Date.UTC(1912, 9, 5, 12)
let session: SessionStore
const id = (key: string): number => session.characters.getBySourceId(key)!.id
const place = (key: string): number => session.locations.getBySourceId(key)!.id
const clock = () => ({ now: NOON, zone: 'UTC' })
const notes = () => noteStore(session, () => DEFAULT_SETTINGS, clock)
const fire = (turn = 1) => fireTriggers(session, { settings: DEFAULT_SETTINGS, turn, round: 1, ...clock(), problem: () => undefined })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) session.characters.add({ ...base, sourceId, name, role: 'npc', control: 'agent' })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'The Bar' }, { key: 'cellar', name: 'The Cellar' }] })
  for (const key of ['alice', 'bob']) session.placements.place('character', id(key), { locationId: place('bar') })
  session.triggers.add({ key: 'smoke', name: 'Smoke', condition: { type: 'time', from: '1912-10-01T00:00' }, repeat: false, priority: 0, effects: [
    { type: 'cue', audience: { characters: ['alice', 'bob'] }, text: 'You smell smoke in {where:@self}.', while: { type: 'place', character: '@self', location: 'bar' } },
    { type: 'beat', text: '{character:alice} is in {where:alice}.', while: { type: 'place', character: 'alice', location: 'bar' } },
  ] }, 'world', 0)
})
afterEach(() => { session.close() })

describe('what a trigger tells, written when it is told', () => {
  it('reports at the moment of firing what is told, in words as the story stands, and keeps the words as written', () => {
    const [fired] = fire().fired
    expect(fired!.cues.map(cue => [cue.names, cue.text])).toEqual([[['Alice'], 'You smell smoke in The Bar.'], [['Bob'], 'You smell smoke in The Bar.']])
    expect(fired!.beats.map(beat => beat.text)).toEqual(['Alice is in The Bar.'])
    expect(session.triggers.notes({ status: 'pending' }).map(note => note.text)).toContain('You smell smoke in {where:@self}.')
  })

  it('withdraws, when the time comes, a cue or beat that no longer applies, and keeps the reason for the list of what the triggers delivered', () => {
    fire()
    session.placements.place('character', id('alice'), { locationId: place('cellar') })
    expect(notes().cuesFor(id('alice'))).toEqual([])
    expect(notes().cuesFor(id('bob')).map(cue => cue.text)).toEqual(['You smell smoke in The Bar.'])
    expect(notes().pendingBeats()).toEqual([])
    expect(session.triggers.notes({ status: 'pending' }).map(note => note.characterIds[0])).toEqual([id('bob')])
    const reasons = readWithdrawn(session)
    expect(Object.values(reasons)).toEqual(['what it was waiting on no longer holds', 'what it was waiting on no longer holds'])
    expect(readInterventions(session).map(entry => [entry.kind, entry.characters, entry.status, entry.reason])).toEqual([
      ['cue', ['Alice'], 'withdrawn', 'what it was waiting on no longer holds'],
      ['cue', ['Bob'], 'waiting', undefined],
      ['beat', [], 'withdrawn', 'what it was waiting on no longer holds'],
    ])
  })

  it('does not tell at all what no longer applied by the time the trigger fired', () => {
    session.placements.place('character', id('alice'), { locationId: place('cellar') })
    const [fired] = fire().fired
    expect(fired!.cues.map(cue => cue.names)).toEqual([['Bob']])
    expect(fired!.beats).toEqual([])
    expect(session.triggers.notes({ status: 'pending' })).toHaveLength(1)
  })
})
