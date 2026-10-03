import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidValueError, NotFoundError, type CharacterId, type NewPerception, type NewStoryEvent, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
let alice: CharacterId
let bob: CharacterId

beforeEach(() => {
  store = memoryStore()
  alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] })).id
  bob = store.characters.add(newCharacter({ sourceId: 'bob', name: 'Bob', aliases: [] })).id
})
afterEach(() => { store.close() })

const event = (overrides: Partial<NewStoryEvent> = {}): NewStoryEvent => ({ turn: 1, round: 1, text: 'Bob takes the key.', importance: 3, tags: ['key'], involves: [bob], ...overrides })
const perception = (characterId: CharacterId, overrides: Partial<NewPerception> = {}): NewPerception => ({
  characterId, mode: 'witnessed', content: 'Bob took the key from the desk.', gist: 'Bob took the key', accuracy: 'accurate', ...overrides,
})

describe('EventRepository', () => {
  it('stores an event with what each character took in, atomically', () => {
    const { event: stored, perceptions } = store.events.add(event(), [perception(alice), perception(bob, { mode: 'inferred', accuracy: 'partial' })])
    expect(stored).toMatchObject({ id: 1, turn: 1, round: 1, text: 'Bob takes the key.', importance: 3, tags: ['key'], involves: [bob] })
    expect(perceptions.map(entry => [entry.characterId, entry.mode, entry.accuracy, entry.recalls])).toEqual([[alice, 'witnessed', 'accurate', 0], [bob, 'inferred', 'partial', 0]])
    expect(store.events.get(stored.id)).toEqual(stored)
    expect(store.events.get(99)).toBeUndefined()
    expect(() => store.events.add(event(), [perception(999)])).toThrow(NotFoundError)
    expect(store.events.list()).toHaveLength(1)
  })

  it('refuses an importance outside 1 to 5 and a character that perceives an event twice', () => {
    expect(() => store.events.add(event({ importance: 6 }), [])).toThrow(InvalidValueError)
    expect(() => store.events.add(event(), [perception(alice), perception(alice)])).toThrow()
    expect(store.events.list()).toEqual([])
  })

  it('lists in story order and filters by turn, character and importance', () => {
    store.events.add(event({ turn: 2, round: 1, text: 'b', involves: [alice], importance: 5 }), [])
    store.events.add(event({ turn: 1, round: 2, text: 'a2' }), [])
    store.events.add(event({ turn: 1, round: 1, text: 'a1', importance: 1 }), [])
    expect(store.events.list().map(entry => entry.text)).toEqual(['a1', 'a2', 'b'])
    expect(store.events.list({ turn: 1 }).map(entry => entry.text)).toEqual(['a1', 'a2'])
    expect(store.events.list({ fromTurn: 2 }).map(entry => entry.text)).toEqual(['b'])
    expect(store.events.list({ toTurn: 1, round: 2 }).map(entry => entry.text)).toEqual(['a2'])
    expect(store.events.list({ involving: alice }).map(entry => entry.text)).toEqual(['b'])
    expect(store.events.list({ minImportance: 3 }).map(entry => entry.text)).toEqual(['a2', 'b'])
  })

  it('corrects an event and replaces who took it in', () => {
    const { event: stored } = store.events.add(event(), [perception(alice)])
    const updated = store.events.update(stored.id, { text: 'Bob takes the brass key.', importance: 4, involves: [alice, bob], tags: [] })
    expect(updated).toMatchObject({ text: 'Bob takes the brass key.', importance: 4, involves: [alice, bob], tags: [] })
    expect(store.events.update(stored.id, { importance: 2 }).text).toBe('Bob takes the brass key.')
    const replaced = store.events.setPerceptions(stored.id, [perception(bob)])
    expect(replaced.map(entry => entry.characterId)).toEqual([bob])
    expect(store.events.perceptionsOf(stored.id)).toEqual(replaced)
    expect(() => store.events.update(99, { text: 'x' })).toThrow(NotFoundError)
    expect(() => store.events.setPerceptions(99, [])).toThrow(NotFoundError)
  })

  it('reads what one character took in with its events, in story order, and counts recalls', () => {
    const first = store.events.add(event({ turn: 1, text: 'first' }), [perception(alice)])
    store.events.add(event({ turn: 3, text: 'third' }), [perception(alice), perception(bob)])
    store.events.add(event({ turn: 2, text: 'second' }), [perception(bob)])
    const seen = store.events.perceivedBy(alice)
    expect(seen.map(entry => entry.event.text)).toEqual(['first', 'third'])
    expect(store.events.perceivedBy(alice, { fromTurn: 2 }).map(entry => entry.event.text)).toEqual(['third'])
    store.events.touchPerceptions([first.perceptions[0]!.id], 5)
    expect(store.events.perceivedBy(alice)[0]?.perception).toMatchObject({ recalls: 1, lastRecalledTurn: 5 })
  })

  it('removes an event with its perceptions and involvement', () => {
    const { event: stored } = store.events.add(event(), [perception(alice)])
    expect(store.events.remove(stored.id)).toBe(true)
    expect(store.events.remove(stored.id)).toBe(false)
    expect(store.events.perceptionsOf(stored.id)).toEqual([])
    expect(store.events.perceivedBy(alice)).toEqual([])
  })

  it('is removed with its character', () => {
    store.events.add(event(), [perception(alice)])
    expect(store.characters.get(alice)).toBeDefined()
  })
})

describe('MemoryRepository', () => {
  it('keeps what a character believes, and counts recalls', () => {
    const memory = store.memories.add({ characterId: alice, kind: 'relationship', text: 'Bob cannot be trusted with keys.', about: [bob], importance: 4, turn: 3 })
    expect(memory).toMatchObject({ id: 1, characterId: alice, kind: 'relationship', about: [bob], importance: 4, turn: 3, recalls: 0 })
    expect(memory).not.toHaveProperty('lastRecalledTurn')
    store.memories.touch([memory.id], 7)
    expect(store.memories.get(memory.id)).toMatchObject({ recalls: 1, lastRecalledTurn: 7 })
    expect(store.memories.list(alice)).toHaveLength(1)
    expect(store.memories.list(bob)).toEqual([])
  })

  it('is corrected and removed, and refused for a missing character or a bad importance', () => {
    const memory = store.memories.add({ characterId: alice, kind: 'belief', text: 'x', about: [], importance: 2, turn: 1 })
    expect(store.memories.update(memory.id, { text: 'y', about: [bob], importance: 5 })).toMatchObject({ text: 'y', about: [bob], importance: 5 })
    expect(() => store.memories.update(99, { text: 'z' })).toThrow(NotFoundError)
    expect(() => store.memories.add({ characterId: 999, kind: 'belief', text: 'x', about: [], importance: 2, turn: 1 })).toThrow(NotFoundError)
    expect(() => store.memories.add({ characterId: alice, kind: 'belief', text: 'x', about: [], importance: 9, turn: 1 })).toThrow(InvalidValueError)
    expect(store.memories.remove(memory.id)).toBe(true)
    expect(store.memories.remove(memory.id)).toBe(false)
  })
})

describe('ThreadRepository', () => {
  it('opens and resolves threads', () => {
    const open = store.threads.open('Who took the key?', 2)
    store.threads.open('Where is Harlan?', 3)
    expect(open).toEqual({ id: 1, text: 'Who took the key?', status: 'open', openedTurn: 2 })
    const resolved = store.threads.resolve(open.id, 5)
    expect(resolved).toEqual({ id: 1, text: 'Who took the key?', status: 'resolved', openedTurn: 2, resolvedTurn: 5 })
    expect(store.threads.list('open').map(thread => thread.text)).toEqual(['Where is Harlan?'])
    expect(store.threads.list()).toHaveLength(2)
    expect(() => store.threads.resolve(99, 1)).toThrow(NotFoundError)
    expect(store.threads.remove(1)).toBe(true)
  })
})

describe('SummaryRepository', () => {
  it('keeps summaries oldest first and removes the ones merged', () => {
    const later = store.summaries.add({ level: 'digest', fromTurn: 5, toTurn: 8, text: 'later' })
    const earlier = store.summaries.add({ level: 'chapter', fromTurn: 1, toTurn: 4, text: 'earlier' })
    expect(store.summaries.list().map(entry => entry.text)).toEqual(['earlier', 'later'])
    expect(store.summaries.list('digest')).toEqual([later])
    store.summaries.remove([earlier.id])
    expect(store.summaries.list()).toEqual([later])
    expect(() => store.summaries.add({ level: 'other' as never, fromTurn: 1, toTurn: 1, text: '' })).toThrow()
  })
})

describe('PendingCommitRepository', () => {
  it('queues rounds in story order, replaces a round queued twice and completes the ones written', () => {
    store.pendingCommits.enqueue(2, 1, { a: 1 })
    store.pendingCommits.enqueue(1, 2, { b: 2 })
    store.pendingCommits.enqueue(1, 1, { c: 3 })
    store.pendingCommits.enqueue(1, 1, { c: 4 })
    expect(store.pendingCommits.list().map(entry => [entry.turn, entry.round, entry.payload])).toEqual([[1, 1, { c: 4 }], [1, 2, { b: 2 }], [2, 1, { a: 1 }]])
    store.pendingCommits.complete([{ turn: 1, round: 1 }, { turn: 1, round: 2 }])
    expect(store.pendingCommits.list().map(entry => entry.turn)).toEqual([2])
  })
})
