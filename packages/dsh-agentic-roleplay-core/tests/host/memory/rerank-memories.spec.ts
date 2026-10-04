import { describe, expect, it } from 'vitest'
import { rerankMemories, type Reranker } from '../../../src/host/memory/rerank-memories.ts'

const candidates = [
  { key: 'p:1', text: 'The brass key is in the clock.', turn: 1, importance: 3 },
  { key: 'p:2', text: '  ', turn: 1, importance: 3 },
  { key: 'm:7', text: 'Bob cannot be trusted.', turn: 2, importance: 4 },
]

describe('reranking the pool of memories', () => {
  it('asks the service to read the situation with each memory, all of them, and scores them by key', async () => {
    const asked: { query: string; documents: readonly string[]; topN?: number }[] = []
    const reranker: Reranker = {
      rerank: (query, documents, options) => {
        asked.push({ query, documents, ...(options?.topN === undefined ? {} : { topN: options.topN }) })
        return Promise.resolve({ results: [{ index: 1, score: 0.9 }, { index: 0, score: 0.2 }] })
      },
    }
    const ranker = rerankMemories({ reranker: () => reranker, problem: () => undefined })
    const judged = await ranker({ situation: 'Where is the key?', candidates })
    expect(asked).toEqual([{ query: 'Where is the key?', documents: ['The brass key is in the clock.', 'Bob cannot be trusted.'], topN: 2 }])
    expect([...judged!]).toEqual([['m:7', 0.9], ['p:1', 0.2]])
  })

  it('has nothing to judge without a service, a situation or memories, and does not ask', async () => {
    let calls = 0
    const reranker: Reranker = { rerank: () => { calls += 1; return Promise.resolve({ results: [] }) } }
    expect(await rerankMemories({ reranker: () => undefined, problem: () => undefined })({ situation: 'x', candidates })).toBeUndefined()
    const ranker = rerankMemories({ reranker: () => reranker, problem: () => undefined })
    expect(await ranker({ situation: '  ', candidates })).toBeUndefined()
    expect(await ranker({ situation: 'x', candidates: [] })).toBeUndefined()
    expect(calls).toBe(0)
  })

  it('reports a failing service once per kind of message, carries on without a judgement, and lets a cancellation through', async () => {
    const problems: string[] = []
    const failing: Reranker = { rerank: () => Promise.reject(new Error('the provider is down')) }
    const ranker = rerankMemories({ reranker: () => failing, problem: (message) => { problems.push(message) } })
    expect(await ranker({ situation: 'x', candidates })).toBeUndefined()
    expect(await ranker({ situation: 'x', candidates })).toBeUndefined()
    expect(problems).toEqual(['rerank: the provider is down: recall goes by retrieval alone'])
    const controller = new AbortController()
    controller.abort()
    await expect(ranker({ situation: 'x', candidates, signal: controller.signal })).rejects.toThrow('the provider is down')
  })

  it('ignores a result for a position it was not asked about', async () => {
    const reranker: Reranker = { rerank: () => Promise.resolve({ results: [{ index: 9, score: 1 }, { index: 0, score: 0.4 }] }) }
    const judged = await rerankMemories({ reranker: () => reranker, problem: () => undefined })({ situation: 'x', candidates })
    expect([...judged!]).toEqual([['p:1', 0.4]])
  })
})
