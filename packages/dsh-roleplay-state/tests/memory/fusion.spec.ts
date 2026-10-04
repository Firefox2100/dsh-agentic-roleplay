import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY_POLICY, finishRecall, fuseScores, poolCandidates, recall, recallPool, type RecallQuery, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('fusing scores', () => {
  it('is the weighted average over the searches that ran, so what only some found is worth less', () => {
    const fused = fuseScores([
      { weight: 1, scores: new Map([['a', 1], ['b', 0.5]]) },
      { weight: 3, scores: new Map([['a', 1], ['c', 1]]) },
    ])
    expect(fused.get('a')).toBeCloseTo(1)
    expect(fused.get('b')).toBeCloseTo(0.125)
    expect(fused.get('c')).toBeCloseTo(0.75)
  })

  it('leaves out a search that found nothing, rather than counting it against every candidate', () => {
    const fused = fuseScores([{ weight: 1, scores: new Map([['a', 0.8]]) }, { weight: 5, scores: new Map() }, { weight: 5, scores: undefined }, { weight: 5, scores: new Map([['z', 0]]) }])
    expect([...fused]).toEqual([['a', 0.8]])
  })

  it('keeps each score within 0 to 1, and is empty when nothing ran', () => {
    expect(fuseScores([{ weight: 1, scores: new Map([['a', 7], ['b', -2]]) }]).get('a')).toBe(1)
    expect(fuseScores([]).size).toBe(0)
  })
})

describe('retrieving more than is used, judging it, and choosing', () => {
  let store: SessionStore
  let alice: number
  beforeEach(() => {
    store = memoryStore()
    alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] })).id
    // Twelve events of equal weight, each about a different thing, one turn apart.
    store.edit({ turn: 1, events: Array.from({ length: 12 }, (_, index) => ({ turn: 1 + index, round: 1, text: `Thing number ${index + 1} happened.`, importance: 3, tags: [], involves: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' as const }] })) })
  })
  afterEach(() => { store.close() })

  const query = (overrides: Partial<RecallQuery['policy']> = {}): RecallQuery => ({
    characterId: alice, characters: store.characters.list(), situation: 'nothing in particular', turn: 13, policy: { ...DEFAULT_MEMORY_POLICY, flaky: false, recall: 2, ...overrides },
  })

  it('keeps recall x overRetrieve candidates for the reranker, and never fewer than recall', () => {
    expect(recallPool(store, query({ overRetrieve: 3 })).entries).toHaveLength(6)
    expect(poolCandidates(recallPool(store, query({ overRetrieve: 3 }))).every(candidate => /^p:\d+$/.test(candidate.key) && candidate.text.startsWith('Thing number'))).toBe(true)
    expect(recallPool(store, query({ overRetrieve: 1 })).entries).toHaveLength(2)
    expect(recallPool(store, query({ overRetrieve: 0 })).entries).toHaveLength(2)
    expect(recallPool(store, query({ recall: 5, overRetrieve: 4 })).entries).toHaveLength(12)
  })

  it('cuts the pool at sixty, however wide the net', () => {
    const wide = memoryStore()
    const who = wide.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] })).id
    wide.edit({ turn: 1, events: Array.from({ length: 80 }, (_, index) => ({ turn: 1, round: 1, text: `Thing ${index}.`, importance: 3, tags: [], involves: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' as const }] })) })
    expect(recallPool(wide, { characterId: who, characters: wide.characters.list(), situation: 'x', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 30, overRetrieve: 10 } }).entries).toHaveLength(60)
    wide.close()
  })

  it('lets a reranker bring forward what retrieval ranked lower, as long as it was in the pool', () => {
    const pool = recallPool(store, query({ overRetrieve: 3 }))
    const without = finishRecall(pool).map(entry => entry.text)
    const inPool = poolCandidates(pool)
    const target = inPool.find(candidate => !without.includes(candidate.text))!
    const judged = new Map(inPool.map(candidate => [candidate.key, candidate.key === target.key ? 1 : 0]))
    const chosen = finishRecall(pool, judged).map(entry => entry.text)
    expect(chosen).toHaveLength(2)
    expect(chosen).toContain(target.text)
    expect(without).not.toContain(target.text)
  })

  it('cannot bring in what is not in the pool, however the reranker judges it', () => {
    const pool = recallPool(store, query({ overRetrieve: 1 }))
    const outside = new Map(recall(store, query({ recall: 12 })).map(entry => [`p:${entry.source.id}`, 1]))
    const chosen = finishRecall(pool, outside).map(entry => entry.source.id)
    expect(chosen.every(id => poolCandidates(pool).some(candidate => candidate.key === `p:${id}`))).toBe(true)
  })

  it('counts a candidate the reranker left out as irrelevant, but lets retrieval still count for something', () => {
    store.edit({ turn: 13, events: [{ turn: 13, round: 1, text: 'The brass key is hidden in the clock.', importance: 3, tags: ['key'], involves: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    const asked: RecallQuery = { ...query({ overRetrieve: 4, recall: 1 }), situation: 'where is the brass key hidden?' }
    const pool = recallPool(store, asked)
    const key = poolCandidates(pool).find(candidate => candidate.text.includes('brass key'))!.key
    expect(finishRecall(pool, new Map()).map(entry => entry.text)).toHaveLength(1)
    expect(finishRecall(pool, new Map([[key, 0.2]])).map(entry => entry.text)).toEqual(['The brass key is hidden in the clock.'])
  })

  it('combines what the words of the index and the meaning of the vectors found, and prefers what both found', () => {
    const hits = (...refs: number[]) => new Map(refs.map((ref, index) => [`p:${ref}`, 1 - index * 0.1] as const))
    const both = recall(store, query({ recall: 1, overRetrieve: 1 }), { lexical: hits(3, 4), dense: hits(3, 5) })
    expect(both.map(entry => entry.text)).toEqual(['Thing number 3 happened.'])
    const denseOnly = recall(store, query({ recall: 1, overRetrieve: 1 }), { dense: hits(7) })
    expect(denseOnly.map(entry => entry.text)).toEqual(['Thing number 7 happened.'])
  })
})
