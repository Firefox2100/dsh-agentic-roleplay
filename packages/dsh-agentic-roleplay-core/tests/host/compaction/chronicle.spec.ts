import { shippedText } from '../../../src/host/prompts/library.ts'
import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composeSummary, estimateTokens, foldSummaries, type Chronicler } from '../../../src/host/compaction/chronicle.ts'
import { readFolded } from '../../../src/host/compaction/engine.ts'
import { encodeOutput } from '../../../src/shared/narration.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

let store: SessionStore
let alice: number
let bob: number
const signal = new AbortController().signal

beforeEach(() => {
  store = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const add = (sourceId: string, name: string) => store.characters.add({
    sourceId, name, aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '',
    speech: { style: '', examples: [] },
  }).id
  alice = add('alice', 'Alice')
  bob = add('bob', 'Bob')
})
afterEach(() => { store.close() })

const event = (turn: number, text: string, importance = 3, involves: number[] = []) => store.events.add({ turn, round: 1, text, importance, tags: [], involves }, [])

/** A chronicler that writes a line of the given size and keeps what it was asked. */
function chronicler(size = 50): Chronicler & { requests: { task: string; material: string; words: number }[] } {
  const requests: { task: string; material: string; words: number }[] = []
  return { requests, write: (request) => { requests.push(request); return Promise.resolve(`Passage ${requests.length}: ${'x'.repeat(size)}`) } }
}
const context = (overrides: Partial<typeof DEFAULT_SETTINGS.context> = {}) => ({ ...DEFAULT_SETTINGS.context, ...overrides })

const chronicleText = (id: string, variables: Record<string, string | number>): string => shippedText(`roleplay/chronicle-${id}`, 'en', variables)

describe('estimateTokens', () => {
  it('counts dense scripts as more tokens per character than spaced ones', () => {
    expect(estimateTokens('x'.repeat(380))).toBe(100)
    expect(estimateTokens('你好'.repeat(50))).toBeGreaterThan(estimateTokens('x'.repeat(100)))
  })
})

describe('foldSummaries', () => {
  it('writes a digest of the leaving turns from their events, and what the player did', async () => {
    event(1, 'Bob took the key.', 4, [bob])
    event(2, 'Alice saw Bob with the key.', 3, [alice, bob])
    event(3, 'The band played.', 1)
    const writer = chronicler()
    await foldSummaries({ story: store, settings: context(), uptoTurn: 2, playerInputs: '- I ask about the key', transcript: 'ignored', chronicler: writer, text: chronicleText, signal })
    expect(writer.requests).toHaveLength(1)
    const [request] = writer.requests
    expect(request?.task).toContain('turns 1 to 2')
    expect(request?.material).toContain('[turn 1] (importance 4) Bob took the key. — involves Bob')
    expect(request?.material).toContain('Alice, Bob')
    expect(request?.material).toContain('I ask about the key')
    expect(request?.material).not.toContain('The band played')
    expect(request?.material).not.toContain('ignored')
    expect(store.summaries.list()).toMatchObject([{ level: 'digest', fromTurn: 1, toTurn: 2 }])
  })

  it('falls back on the conversation as it was told when a turn has no events', async () => {
    event(1, 'Bob took the key.')
    const writer = chronicler()
    await foldSummaries({ story: store, settings: context(), uptoTurn: 2, playerInputs: '', transcript: 'Player: hello\n\nBob waves.', chronicler: writer, text: chronicleText, signal })
    expect(writer.requests[0]?.material).toContain('Bob waves.')
  })

  it('writes only about the turns not yet covered', async () => {
    event(1, 'first'); event(2, 'second'); event(3, 'third'); event(4, 'fourth')
    const writer = chronicler()
    await foldSummaries({ story: store, settings: context(), uptoTurn: 2, playerInputs: '', transcript: '', chronicler: writer, text: chronicleText, signal })
    await foldSummaries({ story: store, settings: context(), uptoTurn: 4, playerInputs: '', transcript: '', chronicler: writer, text: chronicleText, signal })
    expect(writer.requests[1]?.task).toContain('turns 3 to 4')
    expect(writer.requests[1]?.material).not.toContain('first')
    expect(store.summaries.list().map(summary => [summary.fromTurn, summary.toTurn])).toEqual([[1, 2], [3, 4]])
    await foldSummaries({ story: store, settings: context(), uptoTurn: 4, playerInputs: '', transcript: '', chronicler: writer, text: chronicleText, signal })
    expect(writer.requests).toHaveLength(2)
  })

  it('moves the oldest digests into a chapter when the short-term account grows too long', async () => {
    for (let turn = 1; turn <= 6; turn++) event(turn, `event ${turn}`, 4)
    const writer = chronicler(600)
    const settings = context({ shortTermTokens: 300, longTermTokens: 100_000 })
    for (const upto of [2, 4, 6]) await foldSummaries({ story: store, settings, uptoTurn: upto, playerInputs: '', transcript: '', chronicler: writer, text: chronicleText, signal })
    const chapters = store.summaries.list('chapter')
    const digests = store.summaries.list('digest')
    expect(chapters.length).toBeGreaterThan(0)
    expect(chapters[0]?.fromTurn).toBe(1)
    expect(digests.at(-1)?.toTurn).toBe(6)
    expect(digests.every(digest => digest.fromTurn > chapters.at(-1)!.toTurn)).toBe(true)
    const chapterRequest = writer.requests.find(request => request.task.includes('into a chapter'))
    expect(chapterRequest?.material).toContain('Digests to condense')
    expect(chapterRequest?.material).toContain('event 1')
  })

  it('condenses the oldest chapters into one when the long-term account grows too long, from the important events', async () => {
    for (let turn = 1; turn <= 4; turn++) event(turn, `event ${turn}`, turn === 2 ? 5 : 2)
    store.summaries.add({ level: 'chapter', fromTurn: 1, toTurn: 2, text: 'a'.repeat(1500) })
    store.summaries.add({ level: 'chapter', fromTurn: 3, toTurn: 4, text: 'b'.repeat(1500) })
    store.summaries.add({ level: 'digest', fromTurn: 5, toTurn: 5, text: 'short' })
    const writer = chronicler(100)
    await foldSummaries({ story: store, settings: context({ longTermTokens: 300 }), uptoTurn: 5, playerInputs: '', transcript: '', chronicler: writer, text: chronicleText, signal })
    const chapters = store.summaries.list('chapter')
    expect(chapters).toHaveLength(1)
    expect([chapters[0]?.fromTurn, chapters[0]?.toTurn]).toEqual([1, 4])
    expect(writer.requests[0]?.material).toContain('event 2')
    expect(writer.requests[0]?.material).not.toContain('event 1')
  })

  it('stops when the chronicler fails, leaving what was already stored', async () => {
    event(1, 'x')
    const failing: Chronicler = { write: () => Promise.reject(new Error('model down')) }
    await expect(foldSummaries({ story: store, settings: context(), uptoTurn: 1, playerInputs: '', transcript: '', chronicler: failing, text: chronicleText, signal })).rejects.toThrow('model down')
    expect(store.summaries.list()).toEqual([])
  })
})

describe('composeSummary', () => {
  it('puts the long-term account before the short-term one, each with the turns it covers', () => {
    store.summaries.add({ level: 'digest', fromTurn: 7, toTurn: 7, text: 'recent' })
    store.summaries.add({ level: 'chapter', fromTurn: 1, toTurn: 6, text: 'old' })
    expect(composeSummary(store)).toBe('Story so far (long term):\nTurns 1-6: old\n\nRecently (short term):\nTurn 7: recent')
    expect(composeSummary(createSessionStore(':memory:', { id: 'e', name: 'E', world: { id: 'w', name: 'W' } }))).toBe('')
  })
})

describe('readFolded', () => {
  it('reads what the player did and what the conversation told from the messages being folded', () => {
    const output = encodeOutput({ segments: [{ type: 'utterance', character: 'bob', name: 'Bob', text: 'Hi.' }, { type: 'narration', text: 'He waves.' }], repaired: false })
    const folded = readFolded([
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'I greet Bob.' }] },
      { role: 'user', source: { kind: 'roleplay' }, content: [{ type: 'text', text: 'Scene before turn 2' }] },
      { role: 'tool', source: { kind: 'tool', callId: 'x' }, content: [{ type: 'text', text: `delivered\n${output}` }] },
    ] as never)
    expect(folded.playerInputs).toBe('- I greet Bob.')
    expect(folded.transcript).toBe('Player: I greet Bob.\n\nBob: "Hi."\nHe waves.')
  })
})
