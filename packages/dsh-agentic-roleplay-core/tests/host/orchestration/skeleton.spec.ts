import { describe, expect, it } from 'vitest'
import type { CommitEntry, RoundRecord } from '../../../src/host/orchestration/boundaries.ts'
import { skeletonEvents } from '../../../src/host/orchestration/skeleton.ts'

const entry = (character: string, extra: Partial<CommitEntry> = {}): CommitEntry => ({
  character, name: character.toUpperCase(), intent: 'acts', commitment: 'medium', result: 'succeeded', summary: `${character} does something`, spoken: true, at: { key: 'hall', name: 'Hall' }, ...extra,
})

const placeless = (character: string): CommitEntry => { const { at: _at, ...rest } = entry(character); return rest }

const round = (entries: CommitEntry[], extra: Partial<RoundRecord> = {}): RoundRecord => ({
  turn: 3, round: 2, situation: 'the moment', present: [{ character: 'a', place: 'hall' }, { character: 'b', place: 'hall' }, { character: 'c', place: 'cellar' }], entries, ...extra,
})

describe('the plain events of a round', () => {
  it('makes one event for what each character did, in its place, perceived by those who were there', () => {
    const [event, ...rest] = skeletonEvents(round([entry('a')]))
    expect(rest).toEqual([])
    expect(event).toMatchObject({ turn: 3, round: 2, text: 'a does something', location: 'hall', involves: ['a'], tags: [] })
    expect(event?.perceivedBy?.map(seen => seen.character)).toEqual(['a', 'b'])
    expect(event?.perceivedBy?.every(seen => seen.mode === 'witnessed' && seen.content === undefined)).toBe(true)
  })

  it('makes one more for what was said, word for word, which the others hear', () => {
    const events = skeletonEvents(round([entry('a', { utterance: 'Stay where you are.' })]))
    expect(events.map(event => event.text)).toEqual(['a does something', 'A: "Stay where you are."'])
    expect(events[1]?.perceivedBy).toEqual([{ character: 'a', mode: 'witnessed' }, { character: 'b', mode: 'heard' }])
  })

  it('leaves out words that were not said', () => {
    expect(skeletonEvents(round([entry('a', { utterance: 'Never said.', spoken: false })]))).toHaveLength(1)
  })

  it('lets bystanders take in only what the game master said can be seen', () => {
    const [event] = skeletonEvents(round([entry('a', { publicState: 'fidgets with something small' })]))
    expect(event?.perceivedBy).toEqual([{ character: 'a', mode: 'witnessed' }, { character: 'b', mode: 'witnessed', content: 'fidgets with something small', accuracy: 'partial' }])
  })

  it('rates what moved someone or something higher', () => {
    const [plain] = skeletonEvents(round([entry('a')]))
    const [moved] = skeletonEvents(round([entry('a', { moved: { key: 'cellar', name: 'Cellar' } })]))
    expect(moved!.importance).toBeGreaterThan(plain!.importance)
  })

  it('uses the entries alone off stage, where only those named perceive', () => {
    const [event] = skeletonEvents({ turn: 3, round: 101, situation: 'away', offstage: true, entries: [entry('a'), entry('b'), entry('c', { at: { key: 'cellar', name: 'Cellar' } })] })
    expect(event?.perceivedBy?.map(seen => seen.character)).toEqual(['a', 'b'])
  })

  it('has everyone named perceive a round in a world without places', () => {
    const events = skeletonEvents({ turn: 1, round: 1, situation: 'x', entries: [placeless('a'), placeless('b')] })
    expect(events[0]?.perceivedBy?.map(seen => seen.character)).toEqual(['a', 'b'])
    expect(events[0]).not.toHaveProperty('location')
  })
})
