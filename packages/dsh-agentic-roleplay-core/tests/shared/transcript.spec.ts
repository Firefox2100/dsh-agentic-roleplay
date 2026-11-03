import { describe, expect, it } from 'vitest'
import type { Timeline, TimelineNode } from '../../src/shared/timeline.ts'
import { transcriptJson, transcriptMarkdown } from '../../src/shared/transcript.ts'

const node = (id: string, parent: string | null, turn: number, player: string, text: string, extra: Partial<TimelineNode> = {}): TimelineNode => ({
  id, parent, turn, userSeq: turn, player, createdAt: '2026-01-01T00:00:00Z', output: { segments: [{ type: 'narration', text }, { type: 'utterance', character: 'mara', name: 'Mara', text: 'Hello.' }], repaired: false }, ...extra,
})

// n1 -> n2 (set aside) and n1 -> n3 (the head)
const timeline: Timeline = {
  version: 1, head: 'n3', next: 4,
  nodes: [node('n1', null, 1, 'I wave.', 'The pier is quiet.', { label: 'Arrival', note: 'Before the storm' }), node('n2', 'n1', 2, 'I run.', 'You slip.'), node('n3', 'n1', 2, 'I wait.', 'The fog bell rings.', { output: { segments: [{ type: 'narration', text: 'The fog bell rings.' }], repaired: false, rolls: [{ id: 1, text: 'Stealth 14 — succeeded', by: 'agent' }], ooc: { legal: false, note: 'No magic here.' } } })],
}
const opening = [{ type: 'narration' as const, text: 'The story begins.' }]

describe('the transcript', () => {
  it('reads the path as plain prose in a clean export', () => {
    const text = transcriptMarkdown(timeline, { title: 'Salt', opening, scope: 'path', annotated: false })
    expect(text).toContain('# Salt')
    expect(text).toContain('The story begins.')
    expect(text).toContain('*I wave.*')
    expect(text).toContain('**Mara:** “Hello.”')
    expect(text).toContain('The fog bell rings.')
    expect(text).not.toContain('You slip.')
    expect(text).not.toMatch(/###|Roll|checkpoint/u)
  })

  it('adds rulings, rolls and checkpoints when annotated', () => {
    const text = transcriptMarkdown(timeline, { title: 'Salt', scope: 'path', annotated: true })
    expect(text).toContain('### Turn 1 — checkpoint “Arrival”')
    expect(text).toContain('> Note: Before the storm')
    expect(text).toContain('> Roll (agent): Stealth 14 — succeeded')
    expect(text).toContain('> Ruled illegal and refused: No magic here.')
  })

  it('tells the turns set aside from the one the story went with', () => {
    const text = transcriptMarkdown(timeline, { title: 'Salt', scope: 'all', annotated: false })
    expect(text).toContain('alternative 1 of 2 (the story went this way)')
    expect(text).toContain('alternative 2 of 2 (set aside)')
    expect(text.indexOf('The fog bell rings.')).toBeLessThan(text.indexOf('You slip.'))
  })

  it('gives the data form with parents, and the checkpoint only when annotated', () => {
    const all = transcriptJson(timeline, { title: 'Salt', scope: 'all', annotated: true }) as { turns: { id: string; parent: string | null; checkpoint?: unknown }[] }
    expect(all.turns.map(turn => `${turn.id}<${turn.parent}`)).toEqual(['n1<null', 'n2<n1', 'n3<n1'])
    expect(all.turns[0]!.checkpoint).toEqual({ label: 'Arrival', note: 'Before the storm' })
    const clean = transcriptJson(timeline, { title: 'Salt', scope: 'path', annotated: false }) as { turns: { id: string; checkpoint?: unknown }[] }
    expect(clean.turns.map(turn => turn.id)).toEqual(['n1', 'n3'])
    expect(clean.turns[0]!.checkpoint).toBeUndefined()
  })
})
