import { describe, expect, it } from 'vitest'
import { planMove } from '../../../src/host/timeline/plan.ts'
import { childrenOf, noticeText, pathTo, viewOf, type Timeline, type TimelineNode } from '../../../src/shared/timeline.ts'

const node = (id: string, parent: string | null, userSeq: number, endSeq: number | undefined, extra: Partial<TimelineNode> = {}): TimelineNode => ({
  id, parent, turn: userSeq, userSeq, ...(endSeq === undefined ? {} : { endSeq }), player: `say ${id}`, createdAt: 'x', ...extra,
})
const timeline = (nodes: TimelineNode[], head: string | null): Timeline => ({ version: 1, head, next: nodes.length + 1, nodes })
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('the tree of turns', () => {
  const t = timeline([node('n1', null, 10, 19), node('n2', 'n1', 20, 29), node('n3', 'n1', 40, 49), node('n4', 'n2', 60, 69)], 'n4')

  it('has a path from the first turn, and the turns that follow one, in the order played', () => {
    expect(pathTo(t, 'n4').map(entry => entry.id)).toEqual(['n1', 'n2', 'n4'])
    expect(pathTo(t, null)).toEqual([])
    expect(childrenOf(t, 'n1').map(entry => entry.id)).toEqual(['n2', 'n3'])
    expect(childrenOf(t, null).map(entry => entry.id)).toEqual(['n1'])
  })

  it('is told to the client with the turns that can be swapped and the ones that can be gone forward to', () => {
    const view = viewOf({ ...t, head: 'n1' })
    expect(view.path.map(entry => entry.id)).toEqual(['n1'])
    expect(view.forward.map(entry => entry.id)).toEqual(['n2', 'n3'])
    expect(viewOf(t).path.map(entry => [entry.id, entry.alternatives])).toEqual([['n1', ['n1']], ['n2', ['n2', 'n3']], ['n4', ['n4']]])
    expect(viewOf({ ...t, nodes: [{ ...t.nodes[0]!, snapshot: 'after-n1' }, ...t.nodes.slice(1)] }).path[0]!.restorable).toBe(true)
    expect(viewOf(t).path[0]!.restorable).toBe(false)
    expect(viewOf(t).path.map(entry => entry.endSeq)).toEqual(t.nodes.filter(node => ['n1', 'n2', 'n4'].includes(node.id)).map(node => node.endSeq))
  })

  it('tells the stretches of the log that belong to turns the story is not at, so that the transcript can leave them out', () => {
    expect(viewOf(t).withdrawn).toEqual([{ from: 40, to: 49 }])
    expect(viewOf({ ...t, head: 'n1' }).withdrawn).toEqual([{ from: 20, to: 29 }, { from: 40, to: 49 }, { from: 60, to: 69 }])
    expect(viewOf(timeline([node('n1', null, 10, undefined)], null)).withdrawn).toEqual([{ from: 10, to: Number.MAX_SAFE_INTEGER }])
  })

  it('tells what a turn was as a notice: the player\'s words and what was delivered', () => {
    expect(noticeText({ player: 'I knock.', output: { repaired: false, segments: [{ type: 'narration', text: 'The door opens.' }, { type: 'utterance', character: 'clara', name: 'Clara', text: 'Yes?' }] } }))
      .toBe('The story, as it went earlier (restored):\nThe player said: I knock.\nIt was told to the player:\nThe door opens.\nClara: "Yes?"')
    expect(noticeText({ player: 'I knock.' })).toContain('(nothing was delivered)')
  })
})

describe('what is to change on the model\'s conversation to take the story to a turn', () => {
  const t = timeline([node('n1', null, 10, 19), node('n2', 'n1', 20, 29), node('n3', 'n2', 30, 39)], 'n3')
  const surface = range(10, 39)

  it('shadows the turns after it, as one run, and keeps those up to it', () => {
    const plan = planMove(t, 'n1', surface)
    expect(plan.kept).toEqual(['n1'])
    expect(plan.inject).toEqual([])
    expect(plan.shadow).toEqual([{ startSeq: 20, endSeq: 39, seqs: range(20, 39) }])
  })

  it('shadows everything to go back to the start, and nothing to stay where it is', () => {
    expect(planMove(t, null, surface)).toMatchObject({ kept: [], inject: [], shadow: [{ startSeq: 10, endSeq: 39 }] })
    expect(planMove(t, 'n3', surface)).toEqual({ shadow: [], kept: ['n1', 'n2', 'n3'], inject: [] })
  })

  it('tells a turn that is no longer on the conversation again, in order, once the turns before it are', () => {
    const away = { ...t, nodes: t.nodes.map(entry => (entry.id === 'n1' ? entry : { ...entry })) }
    const plan = planMove(away, 'n3', range(10, 19))
    expect(plan.kept).toEqual(['n1'])
    expect(plan.inject.map(entry => entry.id)).toEqual(['n2', 'n3'])
    expect(plan.shadow).toEqual([])
  })

  it('shadows a sibling and what followed it when another turn from the same state is chosen, and tells the chosen one if it was shadowed before', () => {
    const tree = timeline([node('n1', null, 10, 19), node('n2', 'n1', 20, 29), node('n3', 'n1', 40, 49, { noticeSeq: 50 })], 'n3')
    const plan = planMove(tree, 'n2', [10, ...range(11, 19), 50, ...range(40, 49).slice(0, 0)])
    expect(plan.kept).toEqual(['n1'])
    expect(plan.inject.map(entry => entry.id)).toEqual(['n2'])
    expect(plan.shadow).toEqual([{ startSeq: 50, endSeq: 50, seqs: [50] }])
  })

  it('shadows in separate runs what is not next to each other, and ends a turn that did not end at the next one\'s start', () => {
    const tree = timeline([node('n1', null, 10, 19), node('n2', 'n1', 20, undefined), node('n3', 'n2', 30, 39)], 'n3')
    const plan = planMove(tree, 'n1', [...range(10, 19), ...range(20, 22), ...range(30, 32)])
    expect(plan.shadow).toEqual([{ startSeq: 20, endSeq: 32, seqs: [20, 21, 22, 30, 31, 32] }])
    const gapped = planMove(timeline([node('n1', null, 10, 19), node('n2', 'n1', 20, 24), node('n3', 'n1', 30, 34)], 'n3'), 'n1', [10, 11, 20, 21, 25, 30, 31])
    expect(gapped.shadow).toEqual([{ startSeq: 20, endSeq: 21, seqs: [20, 21] }, { startSeq: 30, endSeq: 31, seqs: [30, 31] }])
  })
})
