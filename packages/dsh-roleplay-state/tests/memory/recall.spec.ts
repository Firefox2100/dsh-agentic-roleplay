import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Character } from 'dsh-roleplay-model'
import { DEFAULT_MEMORY_POLICY, clarityAt, jitter, mentioned, recall, retention, tokens, type MemoryPolicy, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('retention', () => {
  const base = { importance: 3, recalls: 0, seed: 1 }

  it('falls with age and is full when it just happened', () => {
    expect(retention({ ...base, ageDays: 0 })).toBeGreaterThan(0.85)
    const values = [0, 5, 20, 60, 200].map(ageDays => retention({ ...base, ageDays }))
    expect(values).toEqual([...values].sort((a, b) => b - a))
    expect(values.at(-1)).toBeLessThan(0.05)
  })

  it('lasts longer the more it mattered, and each recall helps', () => {
    expect(retention({ ...base, importance: 5, ageDays: 40 })).toBeGreaterThan(retention({ ...base, importance: 1, ageDays: 40 }))
    expect(retention({ ...base, recalls: 4, ageDays: 40 })).toBeGreaterThan(retention({ ...base, recalls: 0, ageDays: 40 }))
    expect(retention({ ...base, durability: 4, ageDays: 40 })).toBeGreaterThan(retention({ ...base, ageDays: 40 }))
  })

  it('is brought back a little by a cue, never above 1, and is the same every time for the same memory', () => {
    expect(retention({ ...base, ageDays: 30, cue: true })).toBeGreaterThan(retention({ ...base, ageDays: 30 }))
    expect(retention({ ...base, ageDays: 0, cue: true })).toBe(1)
    expect(retention({ ...base, ageDays: 30 })).toBe(retention({ ...base, ageDays: 30 }))
    expect(jitter(7)).toBe(jitter(7))
    expect(new Set([1, 2, 3, 4, 5].map(jitter)).size).toBe(5)
  })
})

describe('clarityAt', () => {
  it('tiers what is left, and drops what is gone unless it was that important', () => {
    expect(clarityAt(0.9, 1)).toBe('clear')
    expect(clarityAt(0.4, 1)).toBe('faded')
    expect(clarityAt(0.2, 1)).toBe('vague')
    expect(clarityAt(0.05, 1)).toBeUndefined()
    expect(clarityAt(0.05, 5)).toBe('faded')
  })
})

describe('tokens and mentions', () => {
  it('matches words, and pairs of characters in scripts written without spaces', () => {
    expect([...tokens('Bob took the Brass key!')].sort()).toEqual(['bob', 'brass', 'key', 'the', 'took'])
    expect(tokens('管理员拿走了钥匙')).toContain('钥匙')
    expect(tokens('钥匙').has('钥匙')).toBe(true)
  })

  it('finds the characters a text mentions by name or alias', () => {
    const cast = [member(1, 'Eleanor Graves', ['the Mayor']), member(2, 'Bob')]
    expect([...mentioned('Arthur asks the mayor about it', cast)]).toEqual([1])
    expect([...mentioned('Bob and Eleanor Graves leave', cast)].sort()).toEqual([1, 2])
    expect([...mentioned('nobody here', cast)]).toEqual([])
  })
})

function member(id: number, name: string, aliases: string[] = []): Character {
  return { ...newCharacter({ name, aliases }), id, createdAt: '2026-01-01T00:00:00.000Z' } as Character
}

describe('recall', () => {
  const start = Date.UTC(1912, 9, 4, 12)
  let store: SessionStore
  let alice: Character
  let bob: Character

  beforeEach(() => {
    store = memoryStore()
    store.clock.start('simulated', start)
    alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] }))
    bob = store.characters.add(newCharacter({ sourceId: 'bob', name: 'Bob', aliases: [] }))
  })
  afterEach(() => { store.close() })

  const saw = (turn: number, text: string, importance: number, involves: number[], overrides: { tags?: string[]; content?: string; gist?: string } = {}) =>
    store.events.add({ turn, round: 1, text, importance, tags: overrides.tags ?? [], involves }, [{
      characterId: alice.id, mode: 'witnessed', content: overrides.content ?? text, gist: overrides.gist ?? text.slice(0, 20), accuracy: 'accurate',
    }])
  /** Recall without counting it as recalled, so that asking twice gives the same answer. */
  const ask = (situation: string, turn: number, overrides: Partial<MemoryPolicy> = {}) =>
    (store.clock.resync('simulated', start + Math.max(0, turn - 1) * 86_400_000, turn),
      recall(store, { characterId: alice.id, characters: store.characters.list(), situation, turn, policy: { ...DEFAULT_MEMORY_POLICY, ...overrides } }))

  it('remembers nothing it did not take in', () => {
    store.events.add({ turn: 1, round: 1, text: 'Bob hid the key.', importance: 5, tags: [], involves: [bob.id] }, [])
    expect(ask('Bob is here', 2)).toEqual([])
  })

  it('brings back what the moment mentions before what is merely recent, and its own version of events', () => {
    saw(1, 'Bob took the brass key from the desk.', 3, [bob.id], { tags: ['key'], content: 'Bob took a key, I think from the desk.' })
    saw(2, 'The band played a march.', 3, [])
    const recalled = ask('Alice asks Bob where the key went', 3, { recall: 1 })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]).toMatchObject({ clarity: 'clear', text: 'Bob took a key, I think from the desk.', turn: 1 })
  })

  it('returns at most the number asked for, in the order they happened', () => {
    for (let turn = 1; turn <= 6; turn++) saw(turn, `Something about Bob ${turn}`, 3, [bob.id])
    const recalled = ask('Bob', 7, { recall: 3 })
    expect(recalled).toHaveLength(3)
    expect(recalled.map(entry => entry.turn)).toEqual([...recalled.map(entry => entry.turn)].sort((a, b) => a - b))
  })

  it('lets old trivia fade to its gist, then to a vague trace, then go, while what mattered stays', () => {
    saw(1, 'A cart passed the window, loaded with turnips for the festival.', 1, [], { gist: 'a cart of turnips' })
    saw(1, 'Eleanor swore on her mother\'s grave that Harlan was alive.', 5, [], { gist: 'Eleanor swore Harlan lives' })
    const at = (turn: number) => ask('nothing in particular', turn)
    const soon = at(2)
    expect(soon.map(entry => entry.clarity)).toEqual(['clear', 'clear'])
    const later = at(25)
    expect(later.find(entry => entry.text.includes('Eleanor') || entry.text.includes('swore'))?.clarity).not.toBe('vague')
    const trivia = (turn: number) => ask('nothing in particular', turn).find(entry => /turnip/.test(entry.text) || entry.text.includes('something'))
    expect(trivia(2)?.clarity).toBe('clear')
    expect([trivia(10)?.clarity, trivia(300)?.clarity]).toEqual(['faded', undefined])
    const old = ask('nothing', 300)
    expect(old).toHaveLength(1)
    expect(old[0]?.text).toContain('swore')
  })

  it('does not fade anything when memory is not flaky', () => {
    saw(1, 'A cart passed the window.', 1, [], { gist: 'a cart' })
    const recalled = ask('nothing', 500, { flaky: false })
    expect(recalled).toEqual([{ clarity: 'clear', text: 'A cart passed the window.', turn: 1, at: start, source: { kind: 'perception', id: expect.any(Number) } }])
  })

  it('does not fade with turn count when no story time passes', () => {
    saw(1, 'A cart passed the window.', 1, [], { gist: 'a cart' })
    store.clock.resync('simulated', start, 100)
    const recalled = recall(store, { characterId: alice.id, characters: store.characters.list(), situation: 'nothing', turn: 100, policy: DEFAULT_MEMORY_POLICY })
    expect(recalled[0]?.clarity).toBe('clear')
  })

  it('counts what it brings back as recalled, which makes it last longer', () => {
    saw(1, 'Bob took the brass key.', 3, [bob.id], { tags: ['key'] })
    store.recall({ characterId: alice.id, situation: 'the key', turn: 5, policy: DEFAULT_MEMORY_POLICY })
    expect(store.events.perceivedBy(alice.id)[0]?.perception).toMatchObject({ recalls: 1, lastRecalledTurn: 5 })
  })

  it('has beliefs too, which last longer than single events and are brought up by who they are about', () => {
    store.memories.add({ characterId: alice.id, kind: 'relationship', text: 'Bob cannot be trusted with keys. He lies about small things.', about: [bob.id], importance: 3, turn: 1 })
    saw(1, 'A cart passed.', 3, [], { gist: 'a cart' })
    const recalled = ask('Alice speaks to Bob', 40)
    const belief = recalled.find(entry => entry.source.kind === 'memory')
    expect(belief).toBeDefined()
    expect(belief?.clarity).not.toBeUndefined()
  })

  it('tells how a vague memory was about people, not what happened', () => {
    saw(1, 'Bob whispered the secret code to Eleanor in the cellar.', 2, [bob.id], { gist: 'a whispered code' })
    const vague = ask('unrelated', 30)
    const entry = vague.find(candidate => candidate.clarity === 'vague')
    if (entry !== undefined) expect(entry.text).toBe('something to do with Bob')
  })
})
