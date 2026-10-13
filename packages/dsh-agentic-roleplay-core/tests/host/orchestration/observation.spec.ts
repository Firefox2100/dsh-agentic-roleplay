import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { observeAsPlayer } from '../../../src/host/orchestration/observation.ts'

let session: SessionStore
const place = (key: string) => session.locations.getBySourceId(key)!

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'observe', name: 'Observe', world: { id: 'w', name: 'W' } })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar', exits: [{ to: 'square', description: 'the door' }] }, { key: 'square', name: 'Square' }, { key: 'forest', name: 'Forest' }] })
  session.characters.add({ sourceId: 'arthur', name: 'Arthur', aliases: [], kind: 'person', tier: 'principal', role: 'playable', control: 'player', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  session.placements.place('character', session.characters.getBySourceId('arthur')!.id, { locationId: place('bar').id })
})
afterEach(() => { session.close() })

describe('what the player\'s character takes in', () => {
  it('is the place it stands in and the ways out of it, so that it can go back where it came from', () => {
    const arthur = session.characters.getBySourceId('arthur')!.id
    observeAsPlayer(session, 1)
    session.placements.place('character', arthur, { locationId: place('square').id })
    expect(session.planKnownMove(arthur, { to: place('bar').id }).ok).toBe(false)
    observeAsPlayer(session, 2)
    expect(session.planKnownMove(arthur, { to: place('bar').id }).ok).toBe(true)
  })

  it('does not make it know a place nothing leads to from where it stands', () => {
    const arthur = session.characters.getBySourceId('arthur')!.id
    observeAsPlayer(session, 1)
    expect(session.planKnownMove(arthur, { to: place('forest').id }).ok).toBe(false)
  })
})
