import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { playerViewOf } from '../../../src/host/interface/player-view.ts'
import { observeAsPlayer } from '../../../src/host/orchestration/observation.ts'
import { putNote } from '../../../src/host/sessions/notes.ts'

let session: SessionStore
const options = { zone: 'UTC', wall: Date.UTC(1912, 9, 4, 21, 40) }
const person = (sourceId: string, name: string, control: 'player' | 'agent') => session.characters.add({ sourceId, name, aliases: [], kind: 'person', tier: 'principal', role: control === 'player' ? 'playable' : 'npc', control, summary: `${name}, a person.`, personality: 'SECRET PERSONALITY', background: 'SECRET BACKGROUND', appearance: '', speech: { style: '', examples: [] } })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'view', name: 'A story', world: { id: 'w', name: 'W' } })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar', description: 'Smoky.', exits: [{ to: 'square', description: 'the door' }, { to: 'cellar', description: 'a trapdoor' }] }, { key: 'square', name: 'Square' }, { key: 'cellar', name: 'Cellar' }, { key: 'vault', name: 'Vault' }] })
  const arthur = person('arthur', 'Arthur', 'player')
  const clara = person('clara', 'Clara', 'agent')
  const dora = person('dora', 'Dora', 'agent')
  const place = (key: string) => session.locations.getBySourceId(key)!.id
  session.placements.place('character', arthur.id, { locationId: place('bar') })
  session.placements.place('character', clara.id, { locationId: place('bar') })
  session.placements.place('character', dora.id, { locationId: place('vault') })
  session.characterStates.create(arthur.id, { publicState: 'Wet from the rain.', innerState: 'SECRET FEAR', activity: 'SECRET ERRAND' })
  session.characterStates.create(clara.id, { publicState: 'Tired.', innerState: 'SECRET PLAN', activity: 'SECRET POISONING' })
  session.characterStates.create(dora.id, { publicState: 'Elsewhere.', innerState: 'SECRET', activity: 'SECRET' })
  session.edit({ turn: 1, items: [{ key: 'lamp', name: 'Lamp', at: { location: 'bar' } }, { key: 'knife', name: 'Hidden knife', hidden: true, at: { location: 'bar' } }, { key: 'coin', name: 'Coin', quantity: 3, heldBy: 'arthur' }, { key: 'poison', name: 'SECRET poison', hidden: true, heldBy: 'arthur' }] })
  session.variables.define({ key: 'fatigue', name: 'Fatigue', kind: 'number', subject: 'character', min: 0, max: 10, default: 0, visibility: 'public', always: true })
  session.variables.define({ key: 'dread', name: 'Dread', kind: 'number', subject: 'character', min: 0, max: 10, default: 0, visibility: 'private', always: true })
  session.variables.define({ key: 'plot', name: 'Plot', kind: 'flag', subject: 'world', default: false, visibility: 'hidden', always: true })
  session.variables.set('fatigue', 'character', clara.id, { value: 6 }, 1)
  session.variables.set('dread', 'character', clara.id, { value: 9 }, 1)
  session.variables.set('plot', 'world', 0, { value: true }, 1)
  session.clock.start('simulated', Date.UTC(1912, 9, 4, 21, 40))
  observeAsPlayer(session, 1)
})
afterEach(() => { session.close() })

describe('what a pack is told', () => {
  it('is the place, who is there, what lies or is carried, the time and the public variables', () => {
    const view = playerViewOf(session, options)
    expect(view.story).toEqual({ name: 'A story', turn: 0 })
    expect(view.player).toEqual({ key: 'arthur', name: 'Arthur', summary: 'Arthur, a person.', publicState: 'Wet from the rain.' })
    expect(view.place).toMatchObject({ key: 'bar', name: 'Bar', description: 'Smoky.', items: [{ name: 'Lamp', quantity: 1 }], here: [{ key: 'clara', name: 'Clara', publicState: 'Tired.' }] })
    expect(view.carried).toEqual([{ name: 'Coin', quantity: 3, where: 'carried' }])
    expect(view.time).toEqual({ iso: '1912-10-04T21:40:00.000Z', zone: 'UTC', text: 'Friday 4 October 1912, 21:40' })
    expect(view.variables).toContainEqual({ subject: 'Clara', name: 'Fatigue', value: '6' })
  })

  it('knows the places the player has seen the way to, and not the others', () => {
    const view = playerViewOf(session, options)
    expect(view.map.places.map(place => place.key).sort()).toEqual(['bar', 'cellar', 'square'])
    expect(view.map.places.find(place => place.key === 'bar')?.here).toBe(true)
    expect(view.place?.exits).toEqual(expect.arrayContaining([{ name: 'Square', open: true }]))
  })

  it('carries the suggestions the story offered', () => {
    putNote(session as never, { kind: 'suggestions', turn: 1, lines: ['Ask Clara.', 'Leave.'] })
    expect(playerViewOf(session, options).suggestions).toEqual(['Ask Clara.', 'Leave.'])
  })

  it('has the same revision for the same story and another when something changes', () => {
    const before = playerViewOf(session, options)
    expect(playerViewOf(session, options).revision).toBe(before.revision)
    session.characterStates.update(session.characters.getBySourceId('clara')!.id, { publicState: 'Asleep.' })
    expect(playerViewOf(session, options).revision).not.toBe(before.revision)
  })

  it('never carries what the player must not know, whatever is put in the story', () => {
    const text = JSON.stringify(playerViewOf(session, options))
    for (const secret of ['SECRET', 'Hidden knife', 'Vault', 'Dora', 'Dread', 'Plot', '"9"']) expect(text, secret).not.toContain(secret)
  })
})
