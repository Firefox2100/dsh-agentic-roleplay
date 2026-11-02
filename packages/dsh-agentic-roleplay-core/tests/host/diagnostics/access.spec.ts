import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accessOf } from '../../../src/host/diagnostics/access.ts'
import type { CharacterRequest } from '../../../src/host/orchestration/boundaries.ts'

let session: SessionStore
const person = (sourceId: string, name: string, control: 'player' | 'agent') => session.characters.add({ sourceId, name, aliases: [], kind: 'person', tier: 'principal', role: control === 'player' ? 'playable' : 'npc', control, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'access', name: 'A story', world: { id: 'w', name: 'W' } })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar', exits: [{ to: 'square', description: 'the door' }] }, { key: 'square', name: 'Square' }, { key: 'vault', name: 'Vault' }] })
})
afterEach(() => { session.close() })

describe('what a character was given and what the story holds beyond it', () => {
  it('counts what is withheld as the world less what the character knows, and names it only on request', () => {
    const arthur = person('arthur', 'Arthur', 'player')
    const clara = person('clara', 'Clara', 'agent')
    const dora = person('dora', 'Dora', 'agent')
    const place = (key: string) => session.locations.getBySourceId(key)!
    session.placements.place('character', arthur.id, { locationId: place('bar').id })
    session.placements.place('character', clara.id, { locationId: place('bar').id })
    session.placements.place('character', dora.id, { locationId: place('vault').id })
    session.edit({ turn: 1, items: [{ key: 'lamp', name: 'Lamp', at: { location: 'bar' } }, { key: 'knife', name: 'Hidden knife', hidden: true, at: { location: 'bar' } }, { key: 'gem', name: 'Gem', at: { location: 'vault' } }] })
    session.lore.add({ sourceId: 'rite', title: 'The rite', kind: 'other', scope: 'listed', summary: 'A secret.', body: '', subjects: [], related: [], sources: [] })
    session.lore.add({ sourceId: 'town', title: 'The town', kind: 'other', scope: 'everyone', summary: 'Known.', body: '', subjects: [], related: [], sources: [] })
    session.events.add({ turn: 1, round: 1, text: 'Dora hides the gem.', importance: 3, tags: [], involves: [dora.id] }, [{ characterId: dora.id, mode: 'witnessed', content: 'I hid it.', gist: 'hid it', accuracy: 'accurate' }])
    session.relationships.upsert(clara.id, arthur.id, { label: 'guest' }, 1)
    const member = { key: 'clara', character: clara, place: { location: place('bar'), position: '' } }
    const request = {
      member, cast: [{ key: 'arthur', character: arthur }, member], attempt: 1, situation: '', turn: 1,
      knowledge: { characters: ['Arthur'], factions: [], locations: ['Bar', 'Square'], items: ['Lamp'], routes: ['Bar -> Square'], lore: ['The town'] },
      memories: [{ clarity: 'clear' }, { clarity: 'vague' }],
    } as unknown as CharacterRequest

    const plain = accessOf(session as never, request, false)
    expect(plain.given).toMatchObject({ people: 1, places: 2, things: 1, routes: 1, lore: 1, memories: { clear: 1, faded: 0, vague: 1 }, present: 1 })
    expect(plain.withheld).toEqual({ people: 1, places: 1, things: 1, routes: 1, factions: 0, lore: 1, hidden: 1, events: 1 })
    expect(plain).not.toHaveProperty('names')

    const named = accessOf(session as never, request, true)
    expect(named.names).toEqual({ people: ['Dora'], places: ['Vault'], things: ['Gem', 'Hidden knife (hidden)'], lore: ['The rite'] })
  })
})
