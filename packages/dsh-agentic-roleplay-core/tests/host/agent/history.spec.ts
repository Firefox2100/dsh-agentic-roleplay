import { describe, expect, it } from 'vitest'
import { decodeOutput, type TurnOutput } from '../../../src/shared/narration.ts'
import type { Timeline, TimelineNode } from '../../../src/shared/timeline.ts'
import { rebuildChat, repointTimeline } from '../../../src/host/agent/history.ts'

const output = (text: string): TurnOutput => ({ segments: [{ type: 'narration', text }, { type: 'utterance', character: 'clara', name: 'Clara', text: 'Careful.' }], repaired: false, rolls: [] })
const node = (id: string, parent: string | null, turn: number, player: string, text: string): TimelineNode =>
  ({ id, parent, turn, userSeq: 5, startSeq: 4, endSeq: 9, player, output: output(text), createdAt: 'then' })
const opening = [{ type: 'narration' as const, text: 'Rain on the glass.' }]

// n2 is a regenerated sibling of n1 that the story has left
const timeline: Timeline = { version: 1, head: 'n3', next: 4, nodes: [node('n1', null, 2, 'I knock.', 'It opens.'), node('n2', null, 3, 'I knock again.', 'It does not.'), node('n3', 'n1', 3, 'I go in.', 'Dark.')] }

describe('a chat made again from the session folder', () => {
  const rebuilt = rebuildChat(opening, timeline)
  const text = (type: string) => rebuilt.events.filter(event => event.type === type)

  it('holds the opening and then each turn on the way to the head, under the turn numbers it was played with', () => {
    expect(text('turn/start').map(event => (event.data as { turn: number }).turn)).toEqual([1, 2, 3])
    const said = text('user/message').map(event => (event.data as { content: { text: string }[] }).content[0]!.text)
    expect(said).toEqual(['I knock.', 'I go in.'])
  })

  it('delivers each output as it was delivered, so the transcript shows what the player read', () => {
    const delivered = text('tool/result').map(event => decodeOutput(((event.data as { message: { content: { text: string }[] } }).message.content[0]!.text))!)
    expect(delivered.map(each => each.segments[0]!.text)).toEqual(['Rain on the glass.', 'It opens.', 'Dark.'])
    expect(delivered[1]!.segments[1]).toEqual({ type: 'utterance', character: 'clara', name: 'Clara', text: 'Careful.' })
  })

  it('points the turns on the path at the new log and the turns it does not hold at nothing', () => {
    const pointed = repointTimeline(timeline, rebuilt.seqs)
    const by = (id: string) => pointed.nodes.find(candidate => candidate.id === id)!
    expect(by('n1').endSeq).toBe(rebuilt.seqs.get('n1')!.endSeq)
    expect(by('n3').userSeq).toBe(rebuilt.seqs.get('n3')!.userSeq)
    expect(by('n2')).toMatchObject({ userSeq: -1 })
    expect(by('n2').endSeq).toBeUndefined()
    expect(pointed.head).toBe('n3')
  })
})
