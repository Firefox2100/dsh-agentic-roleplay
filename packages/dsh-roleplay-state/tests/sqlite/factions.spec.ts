import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('factions', () => {
  let store: SessionStore
  beforeEach(() => { store = memoryStore() })
  afterEach(() => { store.close() })

  it('stores identity, state, goals and many-to-many membership', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    const watch = store.factions.add({ sourceId: 'watch', name: 'Harbour Watch', aliases: ['The Watch'], summary: 'Guards the harbour.', description: 'A local institution.', values: ['order'], structure: 'Led by the harbourmaster.' })
    store.factionStates.create(watch.id, { publicState: 'Patrolling.', innerState: 'Short of people.' })
    store.factionMemberships.upsert(watch.id, alice.id, { role: 'officer', rank: 'constable', public: false, commitment: 0.8 }, 2)
    store.factionIntents.add(watch.id, { type: 'agenda', name: 'Secure the harbour', description: '', status: 'active', horizon: 'day', priority: 0.8, urgency: 0.6, plan: ['Increase patrols.'], openThreads: [], constraints: [] })

    expect(store.factions.findByName('the watch')).toEqual([watch])
    expect(store.factionStates.get(watch.id)).toMatchObject({ publicState: 'Patrolling.', innerState: 'Short of people.' })
    expect(store.factionMemberships.ofCharacter(alice.id)).toEqual([{ factionId: watch.id, characterId: alice.id, role: 'officer', rank: 'constable', status: 'active', public: false, commitment: 0.8, joinedTurn: 2 }])
    expect(store.factionIntents.list(watch.id)[0]).toMatchObject({ factionId: watch.id, name: 'Secure the harbour' })
  })

  it('keeps every social direction independent', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    const watch = store.factions.add({ sourceId: 'watch', name: 'Watch', aliases: [], summary: '', description: '', values: [], structure: '' })
    store.factionRelationships.upsert('character', alice.id, 'faction', watch.id, { label: 'employer', trust: -0.2 }, 1)
    store.factionRelationships.upsert('faction', watch.id, 'character', alice.id, { label: 'officer', trust: 0.7 }, 1)
    expect(store.factionRelationships.get('character', alice.id, 'faction', watch.id)).toMatchObject({ label: 'employer', trust: -0.2 })
    expect(store.factionRelationships.get('faction', watch.id, 'character', alice.id)).toMatchObject({ label: 'officer', trust: 0.7 })
  })

  it('edits and reads faction records atomically', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    store.characterStates.create(alice.id, { publicState: '', innerState: '', activity: '' })
    const watch = store.factions.add({ sourceId: 'watch', name: 'Watch', aliases: [], summary: '', description: '', values: [], structure: '' })
    store.factionStates.create(watch.id, {})
    store.edit({ turn: 3, factionStates: [{ faction: 'watch', publicState: 'On alert.' }], factionMemberships: [{ faction: 'watch', character: 'alice', role: 'informant', commitment: 0.4 }], factionRelationships: [{ fromKind: 'faction', from: 'watch', toKind: 'character', to: 'alice', label: 'asset' }], factionIntentsAdded: [{ faction: 'watch', type: 'agenda', name: 'Find the intruder', horizon: 'short', priority: 0.8, urgency: 0.9 }] })
    const records = store.records()
    expect(records.factions[0]).toMatchObject({ faction: 'watch', public_state: 'On alert.', members: [{ character: 'alice', role: 'informant', commitment: 0.4 }], goals: [{ name: 'Find the intruder' }] })
    expect(records.faction_relationships).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'watch', to: 'alice', label: 'asset' })]))
  })
})
