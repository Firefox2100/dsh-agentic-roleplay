import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('entity knowledge', () => {
  let store: SessionStore
  beforeEach(() => { store = memoryStore() })
  afterEach(() => { store.close() })

  it('is closed-world, idempotent, and keeps first learning apart from later observation', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    const bar = store.locations.add({ sourceId: 'bar', name: 'Bar', description: '', features: [] })
    expect(store.knowledge.knows(alice.id, 'location', bar.id)).toBe(false)
    expect(store.knowledge.learn(alice.id, 'location', bar.id, 2)).toEqual({ characterId: alice.id, subjectKind: 'location', subjectId: bar.id, learnedTurn: 2 })
    expect(store.knowledge.learn(alice.id, 'location', bar.id, 5, true)).toEqual({ characterId: alice.id, subjectKind: 'location', subjectId: bar.id, learnedTurn: 2, lastObservedTurn: 5 })
    expect(store.knowledge.forget(alice.id, 'location', bar.id)).toBe(true)
    expect(store.knowledge.knows(alice.id, 'location', bar.id)).toBe(false)
  })

  it('validates both ends and removes a character\'s knowledge with it', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    const bar = store.locations.add({ sourceId: 'bar', name: 'Bar', description: '', features: [] })
    expect(() => store.knowledge.learn(999, 'location', bar.id, 1)).toThrow(/character 999/)
    expect(() => store.knowledge.learn(alice.id, 'item', 999, 1)).toThrow(/item 999/)
    store.knowledge.learn(alice.id, 'location', bar.id, 1)
    expect(store.knowledge.list(alice.id)).toHaveLength(1)
  })

  it('is written and retracted through the model edit format and read back by keys', () => {
    const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice' }))
    const bar = store.locations.add({ sourceId: 'bar', name: 'Bar', description: '', features: [] })
    const street = store.locations.add({ sourceId: 'street', name: 'Street', description: '', features: [] })
    store.locations.addExit({ fromId: bar.id, toId: street.id, description: '' })
    store.edit({ turn: 3, knowledge: [
      { character: 'alice', kind: 'location', subject: 'street' },
      { character: 'alice', kind: 'exit', from: 'bar', to: 'street', observed: true },
    ] })
    expect(store.records().knowledge).toEqual([
      { character: 'alice', kind: 'exit', subject: 'bar -> street', learned_turn: 3, last_observed_turn: 3 },
      { character: 'alice', kind: 'location', subject: 'street', learned_turn: 3, last_observed_turn: null },
    ])
    store.edit({ turn: 4, knowledgeRetractions: [{ character: 'alice', kind: 'location', subject: 'street' }] })
    expect(store.knowledge.knows(alice.id, 'location', street.id)).toBe(false)
  })
})
