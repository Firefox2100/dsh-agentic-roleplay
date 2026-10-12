import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EmbeddingIndex, type Embedder } from '../../../src/host/memory/embedding-index.ts'

let store: SessionStore
let embedder: Embedder | undefined
let calls: { texts: readonly string[]; options: Record<string, unknown> | undefined }[]
let problems: string[]
let options: Record<string, string | number | boolean>
let model: string
let failing: Error | undefined

/** Texts about keys point one way, texts about lanterns another. */
const vectorOf = (text: string): number[] => [/key/i.test(text) ? 1 : 0, /lantern/i.test(text) ? 1 : 0, 0.1]

const index = (): EmbeddingIndex => new EmbeddingIndex({
  embedder: () => embedder,
  story: chat => (chat === 'session-1' ? { story: store, options: () => options } : undefined),
  problem: (message) => { problems.push(message) },
  batch: 2,
})

const alice = () => store.characters.getBySourceId('alice')!.id
const saw = (text: string) => store.edit({
  turn: 1, events: [{ turn: 1, round: 1, text, importance: 3, tags: [], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }],
}, { seal: true })

beforeEach(() => {
  store = createSessionStore(':memory:', { id: 'x', name: 'X', world: { id: 'w', name: 'W' } })
  store.characters.add({ sourceId: 'alice', name: 'Alice', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  calls = []
  problems = []
  options = {}
  model = 'm1'
  failing = undefined
  embedder = {
    embed: (texts, given) => {
      calls.push({ texts, options: given })
      if (failing !== undefined) return Promise.reject(failing)
      return Promise.resolve({ vectors: texts.map(vectorOf), model, dimensions: 3 })
    },
  }
})
afterEach(() => { store.close() })

describe('filling the index', () => {
  it('embeds every text that waits, in batches, as documents, with the chat\'s options', async () => {
    saw('Alice hid the key.')
    saw('Alice lit the lantern.')
    options = { dimensions: 3 }
    const embedding = index()
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    expect(store.recallIndex.info()).toEqual({ model: 'm1', dimensions: 3, embedded: 4, pending: 0 })
    expect(calls.map(call => call.texts.length)).toEqual([2, 2])
    expect(calls.every(call => call.options?.['inputType'] === 'document' && call.options['dimensions'] === 3)).toBe(true)
    expect(problems).toEqual([])
  })

  it('serializes what is scheduled for one chat, and does nothing without a service or for a chat it does not know', async () => {
    saw('Alice hid the key.')
    const embedding = index()
    embedding.schedule('session-1')
    embedding.schedule('session-1')
    embedding.schedule('other')
    await embedding.idle('session-1')
    expect(calls).toHaveLength(1)
    saw('Alice lit the lantern.')
    embedder = undefined
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    expect(store.recallIndex.info()?.pending).toBe(2)
    expect(problems).toEqual([])
  })

  it('reports a provider that fails once, however often it is asked, and leaves the texts waiting', async () => {
    saw('Alice hid the key.')
    failing = new Error('the provider is down')
    const embedding = index()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      embedding.schedule('session-1')
      await embedding.idle('session-1')
    }
    expect(problems).toEqual(['embeddings: indexing session-1: the provider is down'])
    expect(store.recallIndex.pending(10)).toHaveLength(2)
    failing = undefined
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    expect(store.recallIndex.info()?.pending).toBe(0)
  })

  it('refuses vectors from another model than the ones stored, and says so', async () => {
    saw('Alice hid the key.')
    const embedding = index()
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    model = 'm2'
    saw('Alice lit the lantern.')
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    expect(problems[0]).toMatch(/this session's vectors are from m1 with 3 dimensions, not m2/)
    expect(store.recallIndex.info()).toMatchObject({ model: 'm1', pending: 2 })
  })
})

describe('the vector of a moment', () => {
  it('is made as a query, and finds what means the same through the stored vectors', async () => {
    saw('Alice hid the key.')
    saw('Alice lit the lantern.')
    const embedding = index()
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    options = { dimensions: 3 }
    const vector = await embedding.queryVector('session-1', 'Where is the key?')
    expect(vector).toEqual([1, 0, 0.1])
    expect(calls.at(-1)?.options).toMatchObject({ inputType: 'query', dimensions: 3 })
    const hits = store.recallIndex.vector({ vector: vector!, characterId: alice(), limit: 3 })
    expect(hits[0]?.score).toBeGreaterThan(0.9)
    expect(store.recallIndex.info()?.embedded).toBe(4)
  })

  it('is nothing while there are no stored vectors, no service, or no text, and starts filling what waits', async () => {
    saw('Alice hid the key.')
    const embedding = index()
    expect(await embedding.queryVector('session-1', 'the key')).toBeUndefined()
    await embedding.idle('session-1')
    expect(store.recallIndex.info()?.embedded).toBe(2)
    expect(await embedding.queryVector('session-1', '   ')).toBeUndefined()
    expect(await embedding.queryVector('other', 'the key')).toBeUndefined()
    embedder = undefined
    expect(await embedding.queryVector('session-1', 'the key')).toBeUndefined()
    expect(problems).toEqual([])
  })

  it('is nothing, with a report, when the provider fails or now gives other vectors than the stored ones', async () => {
    saw('Alice hid the key.')
    const embedding = index()
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    failing = new Error('timeout')
    expect(await embedding.queryVector('session-1', 'the key')).toBeUndefined()
    expect(problems).toEqual(['embeddings: searching session-1: timeout'])
    failing = undefined
    model = 'm2'
    expect(await embedding.queryVector('session-1', 'the key')).toBeUndefined()
    expect(problems[1]).toMatch(/from m1 with 3 dimensions but the embedding provider now gives m2/)
  })

  it('lets an aborted search abort', async () => {
    saw('Alice hid the key.')
    const embedding = index()
    embedding.schedule('session-1')
    await embedding.idle('session-1')
    const controller = new AbortController()
    controller.abort()
    failing = new Error('aborted')
    await expect(embedding.queryVector('session-1', 'the key', controller.signal)).rejects.toThrow('aborted')
  })
})
