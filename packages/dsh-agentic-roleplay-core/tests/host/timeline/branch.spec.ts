import { describe, expect, it } from 'vitest'
import { BranchError, branchName, branchTimeline } from '../../../src/host/timeline/branch.ts'
import type { Timeline, TimelineNode } from '../../../src/shared/timeline.ts'

const node = (id: string, parent: string | null, endSeq: number, extra: Partial<TimelineNode> = {}, snapshot = true): TimelineNode =>
  ({ id, parent, turn: 1, userSeq: endSeq - 4, endSeq, player: id, createdAt: 'now', ...(snapshot ? { snapshot: `after-${id}` } : {}), ...extra })
const timeline = (head: string | null, ...nodes: TimelineNode[]): Timeline => ({ version: 1, head, next: nodes.length + 1, nodes })

describe('what a branch keeps of a story', () => {
  const story = timeline('n3', node('n1', null, 10), node('n2', 'n1', 20), node('n3', 'n2', 30, { noticeSeq: 28 }))
  const all = ['start', 'after-n1', 'after-n2', 'after-n3']

  it('stands at the turn that ended last at or before the cut, with the turns up to it and their snapshots', () => {
    const branch = branchTimeline(story, 25, all)
    expect(branch.timeline.head).toBe('n2')
    expect(branch.timeline.nodes.map(each => each.id)).toEqual(['n1', 'n2'])
    expect(branch.from).toEqual({ snapshot: 'after-n2' })
    expect(branch.keep).toEqual(['after-n1', 'after-n2', 'start'])
    expect(branchTimeline(story, 30, all).timeline.head).toBe('n3')
  })

  it('does not change the timeline it is cut from, and forgets notices after the cut', () => {
    const cut = timeline('n2', node('n1', null, 10, { noticeSeq: 50 }), node('n2', 'n1', 20))
    expect(branchTimeline(cut, 25, all).timeline.nodes[0]!.noticeSeq).toBeUndefined()
    expect(cut.nodes[0]!.noticeSeq).toBe(50)
  })

  it('stands at the start when no turn had ended', () => {
    const branch = branchTimeline(story, 5, all)
    expect(branch.timeline).toMatchObject({ head: null, nodes: [] })
    expect(branch.from).toEqual({ snapshot: 'start' })
    expect(() => branchTimeline(story, 5, ['after-n1'])).toThrow(BranchError)
  })

  it('uses the live state for the turn the story stands at when it has no snapshot yet, and refuses any other without one', () => {
    const fresh = timeline('n2', node('n1', null, 10), node('n2', 'n1', 20, {}, false))
    expect(branchTimeline(fresh, 20, ['start', 'after-n1']).from).toEqual({ live: true })
    const old = timeline('n3', node('n1', null, 10), node('n2', 'n1', 20, { snapshot: 'after-n2' }), node('n3', 'n2', 30))
    expect(() => branchTimeline(old, 25, ['start', 'after-n1', 'after-n3'])).toThrow(BranchError)
  })
})

describe('the name of a branch', () => {
  it('counts a trailing number up, or adds a 2', () => {
    expect(branchName('Night')).toBe('Night 2')
    expect(branchName('Night 2')).toBe('Night 3')
    expect(branchName('Night 9 ')).toBe('Night 10')
    expect(branchName('Chapter 1 of 3')).toBe('Chapter 1 of 4')
    expect(branchName('x'.repeat(200)).length).toBeLessThanOrEqual(200)
  })
})
