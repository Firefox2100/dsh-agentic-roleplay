import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, DEFAULT_MEMORY_POLICY, InvalidValueError, createSessionStore, openSessionStore, type CharacterId, type SessionStore } from '../../src/index.ts'
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

const saw = (who: CharacterId, text: string, extra: Partial<{ turn: number; tags: string[]; involves: CharacterId[]; importance: number }> = {}) =>
  store.events.add(
    { turn: extra.turn ?? 1, round: 1, text, importance: extra.importance ?? 3, tags: extra.tags ?? [], involves: extra.involves ?? [] },
    [{ characterId: who, mode: 'witnessed', content: text, gist: text.slice(0, 20), accuracy: 'accurate' }],
  )
const lexical = (text: string, characterId?: CharacterId, kinds?: ('perception' | 'memory' | 'event')[]) =>
  store.recallIndex.lexical({ text, limit: 10, ...(characterId === undefined ? {} : { characterId }), ...(kinds === undefined ? {} : { kinds }) }).map(hit => hit.key)

describe('searching by words, with plenty of text', () => {
  it('ignores words found in most texts, unless nothing else is asked for, and drops weak matches', () => {
    for (const text of ['The cook burned the soup.', 'The mayor gave the speech.', 'The band played the march.', 'The brass key was hidden by the door.', 'The farmer sold the cows.', 'The baker lost the keys of the shop.']) saw(alice, text)
    const keys = (text: string) => store.recallIndex.lexical({ text, kinds: ['event'], limit: 10 }).map(hit => hit.key)
    expect(keys('Where is the brass key hidden?')).toHaveLength(1)
    expect(keys('the')).toHaveLength(6)
  })
})

describe('searching by words', () => {
  it('finds what a character took in, what it believes and what happened, each by its key, without crossing characters', () => {
    const first = saw(alice, 'Alice hid the brass key under the floor.')
    saw(bob, 'Bob found a brass lantern in the cellar.')
    const belief = store.memories.add({ characterId: alice, kind: 'belief', text: 'The brass key opens the vault.', about: [], importance: 3, turn: 1 })
    expect(new Set(lexical('brass key', alice))).toEqual(new Set([`p:${first.perceptions[0]!.id}`, `m:${belief.id}`]))
    expect(lexical('lantern', alice)).toEqual([])
    expect(lexical('lantern', bob)).toHaveLength(1)
    expect(lexical('key floor', undefined, ['event'])).toEqual([`e:${first.event.id}`])
  })

  it('ranks the better match first and scores the rest relative to it', () => {
    saw(alice, 'The key key key was on the table.')
    saw(alice, 'A key was somewhere.')
    const hits = store.recallIndex.lexical({ text: 'key table', characterId: alice, limit: 10 })
    expect(hits).toHaveLength(2)
    expect(hits[0]!.score).toBe(1)
    expect(hits[1]!.score).toBeGreaterThan(0)
    expect(hits[1]!.score).toBeLessThan(1)
  })

  it('matches by the tags of the event too, and by pairs of characters in scripts written without spaces', () => {
    saw(alice, 'She hid it where nobody looks.', { tags: ['vault', 'secret'] })
    expect(lexical('the vault', alice)).toHaveLength(1)
    saw(alice, '管理员拿走了钥匙，然后离开了天文台。')
    expect(lexical('钥匙', alice)).toHaveLength(1)
    expect(lexical('天文台的管理员', alice)).toHaveLength(1)
  })

  it('is safe for a situation full of punctuation, operators and quotes, and finds nothing for an empty one', () => {
    saw(alice, 'He said "stop" and ran.')
    expect(lexical('"stop" AND (run* OR NOT -ran) NEAR/3 ^x', alice)).toHaveLength(1)
    expect(lexical('', alice)).toEqual([])
    expect(lexical('a b', alice)).toEqual([])
    expect(lexical('zzzz', alice)).toEqual([])
  })

  it('follows what is changed: a corrected text, new perceivers, a removed event and a removed belief', () => {
    const { event } = saw(alice, 'The coin was silver.')
    expect(lexical('silver', alice)).toHaveLength(1)
    store.events.setPerceptions(event.id, [{ characterId: alice, mode: 'heard', content: 'The coin was golden.', gist: 'g', accuracy: 'mistaken' }])
    expect(lexical('silver', alice)).toEqual([])
    expect(lexical('golden', alice)).toHaveLength(1)
    store.events.update(event.id, { text: 'The coin was copper.', tags: ['coin'] })
    expect(lexical('copper', undefined, ['event'])).toEqual([`e:${event.id}`])
    expect(lexical('coin', alice)).toHaveLength(1)
    store.events.remove(event.id)
    expect(lexical('coin')).toEqual([])
    const belief = store.memories.add({ characterId: bob, kind: 'belief', text: 'Alice cannot be trusted.', about: [alice], importance: 2, turn: 1 })
    expect(lexical('trusted', bob)).toEqual([`m:${belief.id}`])
    store.memories.update(belief.id, { text: 'Alice can be relied on.' })
    expect(lexical('trusted')).toEqual([])
    expect(lexical('relied', bob)).toHaveLength(1)
    store.memories.remove(belief.id)
    expect(lexical('relied')).toEqual([])
  })
})

/** Vectors that point where the text is about: the first axis is keys, the second lanterns. */
const direction = (...values: number[]): number[] => values

describe('storing vectors', () => {
  it('lists the texts that wait for one, and fixes the model and dimensions with the first vectors stored', () => {
    const one = saw(alice, 'Alice hid the key.')
    saw(bob, 'Bob lit the lantern.')
    expect(store.recallIndex.info()).toBeUndefined()
    const pending = store.recallIndex.pending(10)
    expect(pending.map(item => [item.kind, item.text])).toEqual([['event', 'Alice hid the key.'], ['perception', 'Alice hid the key.'], ['event', 'Bob lit the lantern.'], ['perception', 'Bob lit the lantern.']])
    expect(store.recallIndex.pending(1)).toHaveLength(1)
    const stored = store.recallIndex.store('test-model', pending.slice(0, 2).map(item => ({ id: item.id, vector: direction(1, 0, 0) })))
    expect(stored).toBe(2)
    expect(store.recallIndex.info()).toEqual({ model: 'test-model', dimensions: 3, embedded: 2, pending: 2 })
    expect(store.recallIndex.pending(10).map(item => item.text)).toEqual(['Bob lit the lantern.', 'Bob lit the lantern.'])
    expect(one.event.id).toBeGreaterThan(0)
  })

  it('refuses vectors of another model or size, or of different sizes, until they are reset', () => {
    saw(alice, 'a thing')
    const [item] = store.recallIndex.pending(1)
    store.recallIndex.store('m1', [{ id: item!.id, vector: [1, 0] }])
    expect(() => store.recallIndex.store('m2', [{ id: item!.id, vector: [1, 0] }])).toThrow(ConflictError)
    expect(() => store.recallIndex.store('m1', [{ id: item!.id, vector: [1, 0, 0] }])).toThrow(/not m1 with 3 dimensions|from m1 with 2 dimensions/)
    expect(() => store.recallIndex.store('m1', [{ id: item!.id, vector: [1, 0] }, { id: item!.id + 1, vector: [1] }])).toThrow(InvalidValueError)
    store.recallIndex.reset()
    expect(store.recallIndex.info()).toBeUndefined()
    expect(store.recallIndex.pending(10)).toHaveLength(2)
    expect(store.recallIndex.store('m2', [{ id: item!.id, vector: [1, 0, 0, 0] }])).toBe(1)
    expect(store.recallIndex.info()?.dimensions).toBe(4)
  })

  it('ignores a vector for a text that is gone, and drops the vector of a text that changes or is removed', () => {
    const { event, perceptions } = saw(alice, 'Alice hid the key.')
    const all = store.recallIndex.pending(10)
    expect(store.recallIndex.store('m', [...all.map(item => ({ id: item.id, vector: [1, 0] })), { id: 9999, vector: [1, 0] }])).toBe(all.length)
    expect(store.recallIndex.info()?.pending).toBe(0)
    store.events.setPerceptions(event.id, [{ characterId: alice, mode: 'witnessed', content: 'Alice hid the lantern.', gist: 'g', accuracy: 'accurate' }])
    expect(store.recallIndex.pending(10).map(item => item.text)).toEqual(['Alice hid the lantern.'])
    store.events.update(event.id, { tags: ['only', 'tags'] })
    expect(store.recallIndex.pending(10).map(item => item.text)).toEqual(['Alice hid the lantern.'])
    store.events.remove(event.id)
    expect(store.recallIndex.info()).toMatchObject({ embedded: 0, pending: 0 })
    expect(perceptions).toHaveLength(1)
  })
})

describe('searching by meaning', () => {
  const setup = () => {
    const keyOfAlice = saw(alice, 'Alice hid the brass key.')
    const lanternOfAlice = saw(alice, 'Alice carried the lantern upstairs.')
    const keyOfBob = saw(bob, 'Bob found a key in the hall.')
    const vectors: Record<string, number[]> = { 'Alice hid the brass key.': direction(1, 0, 0), 'Alice carried the lantern upstairs.': direction(0, 1, 0), 'Bob found a key in the hall.': direction(0.9, 0.1, 0) }
    store.recallIndex.store('m', store.recallIndex.pending(100).map(item => ({ id: item.id, vector: vectors[item.text] ?? direction(0, 0, 1) })))
    return { keyOfAlice, lanternOfAlice, keyOfBob }
  }

  it('finds the nearest texts of one character by the cosine of the angle, and never another character\'s', () => {
    const { keyOfAlice, lanternOfAlice } = setup()
    const hits = store.recallIndex.vector({ vector: direction(1, 0.2, 0), characterId: alice, limit: 5 })
    expect(hits.map(hit => hit.key)).toEqual([`p:${keyOfAlice.perceptions[0]!.id}`, `p:${lanternOfAlice.perceptions[0]!.id}`])
    expect(hits[0]!.score).toBeGreaterThan(0.95)
    expect(hits[1]!.score).toBeLessThan(0.3)
    expect(store.recallIndex.vector({ vector: direction(1, 0, 0), characterId: bob, limit: 5 })).toHaveLength(1)
    expect(store.recallIndex.vector({ vector: direction(1, 0, 0), characterId: 0, limit: 5 }).every(hit => hit.kind === 'event')).toBe(true)
  })

  it('answers with nothing while no vectors are stored, and refuses a query of the wrong size', () => {
    saw(alice, 'a thing')
    expect(store.recallIndex.vector({ vector: [1, 0, 0], characterId: alice, limit: 5 })).toEqual([])
    setup()
    expect(() => store.recallIndex.vector({ vector: [1, 0], characterId: alice, limit: 5 })).toThrow(/query has 2 dimensions.*have 3/)
  })

  it('brings back what the moment means though not a word of it is shared, and keeps the character apart', () => {
    setup()
    const query = { characterId: alice, situation: 'Where is the thing that opens the door?', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 1, flaky: false } }
    const cues = store.recallStored(query)
    const meaning = store.recallStored(query, { queryVector: direction(1, 0.05, 0) })
    expect(meaning.map(entry => entry.text)).toEqual(['Alice hid the brass key.'])
    expect(cues).toHaveLength(1)
    const again = store.recallStored({ ...query, characterId: bob }, { queryVector: direction(1, 0.05, 0) })
    expect(again.map(entry => entry.text)).toEqual(['Bob found a key in the hall.'])
  })

  it('uses what matches by words as well, and counts what it recalled', () => {
    saw(alice, 'The lantern was green.', { importance: 1 })
    saw(alice, 'The festival was loud.', { importance: 1 })
    const recalled = store.recallStored({ characterId: alice, situation: 'Is the lantern still green?', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 1, flaky: false } })
    expect(recalled.map(entry => entry.text)).toEqual(['The lantern was green.'])
    expect(store.events.perceivedBy(alice)[0]?.perception.recalls).toBe(1)
  })
})

describe('searching what happened', () => {
  it('merges the search by words and by meaning, best of either first, and narrows by turn and importance', () => {
    const key = saw(alice, 'The brass key was hidden.', { turn: 1, importance: 4 })
    const door = saw(alice, 'The vault door was opened.', { turn: 3, importance: 2 })
    saw(bob, 'The band played a march.', { turn: 5, importance: 1 })
    expect(store.searchEvents({ text: 'brass key' }).map(event => event.id)).toEqual([key.event.id])
    const vectors: Record<string, number[]> = { 'The brass key was hidden.': direction(1, 0), 'The vault door was opened.': direction(0.7, 0.7), 'The band played a march.': direction(0, 1) }
    store.recallIndex.store('m', store.recallIndex.pending(100).map(item => ({ id: item.id, vector: vectors[item.text]! })))
    const found = store.searchEvents({ text: 'brass key', vector: direction(0.8, 0.6) })
    expect(found.map(event => event.id)).toEqual([key.event.id, door.event.id, expect.any(Number)].slice(0, found.length))
    expect(found[0]!.id).toBe(key.event.id)
    expect(store.searchEvents({ text: 'brass key', vector: direction(0.8, 0.6), minImportance: 3 }).map(event => event.id)).toEqual([key.event.id])
    expect(store.searchEvents({ text: 'brass key', vector: direction(0.8, 0.6), fromTurn: 2, toTurn: 4 }).map(event => event.id)).toEqual([door.event.id])
    expect(store.searchEvents({ text: 'brass key', vector: direction(0.8, 0.6), limit: 1 })).toHaveLength(1)
  })
})

describe('without the vector extension', () => {
  it('still searches by words, says why vectors are missing, and refuses to store them', () => {
    const plain = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } }, { vectors: false })
    const who = plain.characters.add(newCharacter({ sourceId: 'x', name: 'X', aliases: [] })).id
    plain.events.add({ turn: 1, round: 1, text: 'The coin was silver.', importance: 2, tags: [], involves: [] }, [{ characterId: who, mode: 'witnessed', content: 'The coin was silver.', gist: 'g', accuracy: 'accurate' }])
    expect(plain.recallIndex.vectors).toEqual({ available: false, error: 'switched off' })
    expect(plain.recallIndex.lexical({ text: 'silver', characterId: who, limit: 5 })).toHaveLength(1)
    expect(plain.recallIndex.vector({ vector: [1], limit: 5 })).toEqual([])
    expect(() => plain.recallIndex.store('m', [{ id: 1, vector: [1] }])).toThrow(ConflictError)
    plain.close()
  })

  it('has the extension by default', () => {
    expect(store.recallIndex.vectors).toEqual({ available: true })
  })
})

describe('across opening the session again', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'recall-index-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('keeps the texts, the vectors and what they were made by', () => {
    const location = join(dir, 'session.sqlite')
    const first = createSessionStore(location, { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    const who = first.characters.add(newCharacter({ sourceId: 'x', name: 'X', aliases: [] })).id
    first.events.add({ turn: 1, round: 1, text: 'The coin was silver.', importance: 2, tags: [], involves: [] }, [{ characterId: who, mode: 'witnessed', content: 'The coin was silver.', gist: 'g', accuracy: 'accurate' }])
    first.recallIndex.store('m', first.recallIndex.pending(10).map(item => ({ id: item.id, vector: [0, 1] })))
    first.close()
    const second = openSessionStore(location)
    expect(second.recallIndex.info()).toEqual({ model: 'm', dimensions: 2, embedded: 2, pending: 0 })
    expect(second.recallIndex.lexical({ text: 'silver', characterId: who, limit: 5 })).toHaveLength(1)
    expect(second.recallIndex.vector({ vector: [0, 1], characterId: who, limit: 5 })[0]?.score).toBeCloseTo(1)
    second.close()
  })
})
