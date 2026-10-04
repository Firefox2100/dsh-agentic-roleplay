import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../../src/plugin.ts'
import { DEFAULT_MEMORY_POLICY, recall, recallCandidates, type RecallQuery, type SemanticRanker, type Session } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('recalling by meaning', () => {
  const store = memoryStore()
  const alice = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] }))
  store.edit({ turn: 1, events: [
    { turn: 1, round: 1, text: 'The treasure is under the old oak.', importance: 3, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
    { turn: 1, round: 1, text: 'The band played a march.', importance: 4, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
  ] })
  const query = (situation: string): Omit<RecallQuery, 'characters'> => ({ characterId: alice.id, situation, turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 1 } })
  const all = { characters: store.characters.list() }

  it('offers every candidate with the text to match, named by a key', () => {
    const candidates = recallCandidates(store, { ...query('where is the gold buried?'), ...all })
    expect(candidates.map(candidate => [candidate.key, candidate.text, candidate.turn, candidate.importance])).toEqual([
      ['p:1', 'The treasure is under the old oak.', 1, 3], ['p:2', 'The band played a march.', 1, 4],
    ])
  })

  it('lets a semantic match bring back what no cue would: the gold is not a word of the treasure event', () => {
    expect(recall(store, { ...query('where is the gold buried?'), ...all }).map(entry => entry.text)).toEqual(['The band played a march.'])
    const semantic = new Map([['p:1', 0.9], ['p:2', 0.05]])
    expect(recall(store, { ...query('where is the gold buried?'), ...all }, { rerank: semantic }).map(entry => entry.text)).toEqual(['The treasure is under the old oak.'])
  })
})

describe('a ranker from another plugin', () => {
  let dir: string
  let ctx: Context
  let session: Session
  let ranker: SemanticRanker
  let warnings: string[]
  let unrank: (() => void) | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ranker-'))
    ctx = new Context()
    ctx.plugin(plugin as never, {} as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    warnings = []
    ctx.logger.warn = ((message: string) => { warnings.push(message) }) as never
    session = ctx.roleplayState.createSession(dir, { name: 'S', world: { id: 'w', name: 'W' } })
    session.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] }))
    session.edit({ turn: 1, events: [
      { turn: 1, round: 1, text: 'The treasure is under the old oak.', importance: 3, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
      { turn: 1, round: 1, text: 'The band played a march.', importance: 4, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
    ] })
    ranker = ({ candidates }) => Promise.resolve(new Map(candidates.map(candidate => [candidate.key, candidate.text.includes('treasure') ? 1 : 0])))
  })
  afterEach(async () => {
    unrank?.()
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  const ask = () => session.recallRanked({ characterId: 1, situation: 'where is the gold?', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 1 } })

  it('is used by every recall once registered, and no longer once removed', async () => {
    expect((await ask()).map(entry => entry.text)).toEqual(['The band played a march.'])
    unrank = ctx.roleplayState.rankMemories(ranker)
    expect((await ask()).map(entry => entry.text)).toEqual(['The treasure is under the old oak.'])
    unrank()
    unrank = undefined
    expect((await ask()).map(entry => entry.text)).toEqual(['The band played a march.'])
  })

  it('uses the latest ranker registered', async () => {
    const first = ctx.roleplayState.rankMemories(() => Promise.resolve(new Map([['p:2', 1]])))
    unrank = ctx.roleplayState.rankMemories(ranker)
    expect((await ask()).map(entry => entry.text)).toEqual(['The treasure is under the old oak.'])
    first()
  })

  it('does not stop recall when it fails: retrieval carries on and the log says why', async () => {
    unrank = ctx.roleplayState.rankMemories(() => Promise.reject(new Error('embedding service is down')))
    expect((await ask()).map(entry => entry.text)).toEqual(['The band played a march.'])
    expect(warnings).toEqual([expect.stringContaining('embedding service is down')])
  })

  it('carries on by retrieval alone when it has nothing to judge, and without a warning', async () => {
    unrank = ctx.roleplayState.rankMemories(() => Promise.resolve(undefined))
    expect((await ask()).map(entry => entry.text)).toEqual(['The band played a march.'])
    expect(warnings).toEqual([])
  })

  it('is asked about the pool the recall over-retrieved, not about everything', async () => {
    for (let index = 0; index < 20; index++) session.edit({ turn: 1, events: [{ turn: 1, round: 1, text: `Filler ${index}.`, importance: 1, tags: [], involves: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    const sizes: number[] = []
    unrank = ctx.roleplayState.rankMemories(({ candidates }) => { sizes.push(candidates.length); return Promise.resolve(undefined) })
    await session.recallRanked({ characterId: 1, situation: 'x', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 2, overRetrieve: 3 } })
    await session.recallRanked({ characterId: 1, situation: 'x', turn: 2, policy: { ...DEFAULT_MEMORY_POLICY, recall: 2, overRetrieve: 1 } })
    expect(sizes).toEqual([6, 2])
  })

  it('passes the situation and the signal on, and lets a cancellation through', async () => {
    const seen: { situation: string; signal?: AbortSignal }[] = []
    unrank = ctx.roleplayState.rankMemories((input) => { seen.push(input); return Promise.reject(new Error('aborted')) })
    const controller = new AbortController()
    controller.abort()
    await expect(session.recallRanked({ characterId: 1, situation: 'x', turn: 2, policy: DEFAULT_MEMORY_POLICY }, controller.signal)).rejects.toThrow('aborted')
    expect(seen[0]?.situation).toBe('x')
    expect(seen[0]?.signal).toBe(controller.signal)
  })
})
