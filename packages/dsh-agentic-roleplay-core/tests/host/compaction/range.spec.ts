import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { selectFoldRange, turnsOf } from '../../../src/host/compaction/range.ts'

let seq = 0
const event = (type: string, data: unknown = {}): SessionEvent => ({ seq: seq++ as SessionSeq, type, data, time: 0 } as unknown as SessionEvent)
const player = (text: string) => event('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const notice = () => event('user/message', { role: 'user', source: { kind: 'roleplay' }, content: [] })

/** A system node, then for each turn: turn start, the player's message, a notice, the model's reply, a tool result. */
function conversation(turns: number): { events: SessionEvent[]; nodes: { seq: SessionSeq; tokens: number }[] } {
  seq = 0
  const events: SessionEvent[] = [event('system/message', {})]
  for (let turn = 1; turn <= turns; turn++) {
    events.push(event('turn/start', { turn }), player(`move ${turn}`), notice(), event('assistant/message', {}), event('tool/result', {}), event('turn/end', { turn }))
  }
  const surface = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])
  return { events, nodes: events.filter(entry => surface.has(entry.type)).map(entry => ({ seq: entry.seq, tokens: 100 })) }
}

describe('turnsOf', () => {
  it('gives each event the turn that had started by then', () => {
    const { events } = conversation(2)
    const turns = turnsOf(events)
    expect(turns.get(events[2]!.seq)).toBe(1)
    expect(turns.get(events[9]!.seq)).toBe(2)
    expect(turns.get(events[0]!.seq)).toBe(0)
  })
})

describe('selectFoldRange', () => {
  it('folds the whole turns before the player message that leaves at least what is to be kept', () => {
    const { events, nodes } = conversation(6)
    const range = selectFoldRange({ events, nodes, retainTokens: 1000 })
    expect(range).not.toBeNull()
    // 6 turns of 4 nodes at 100 tokens: the last 3 turns hold 1200, the last 2 hold 800
    expect(range?.uptoTurn).toBe(3)
    const startIndex = nodes.findIndex(node => node.seq === range!.start)
    expect(startIndex).toBe(1)
    const next = nodes[nodes.findIndex(node => node.seq === range!.end) + 1]!
    expect(events.find(entry => entry.seq === next.seq)?.type).toBe('user/message')
    expect(turnsOf(events).get(next.seq)).toBe(4)
  })

  it('never splits a turn: the range ends right before a player message', () => {
    const { events, nodes } = conversation(8)
    for (const retain of [150, 450, 900, 1300, 2500]) {
      const range = selectFoldRange({ events, nodes, retainTokens: retain })
      if (range === null) continue
      const after = nodes[nodes.findIndex(node => node.seq === range.end) + 1]!
      const afterEvent = events.find(entry => entry.seq === after.seq)!
      expect(afterEvent.type).toBe('user/message')
      expect((afterEvent.data as { source: { kind: string } }).source.kind).toBe('user')
    }
  })

  it('keeps the system node out of the range, and says nothing can be folded when too little would be kept', () => {
    const { events, nodes } = conversation(3)
    expect(selectFoldRange({ events, nodes, retainTokens: 100_000 })).toBeNull()
    const range = selectFoldRange({ events, nodes, retainTokens: 1 })
    expect(range?.start).not.toBe(nodes[0]!.seq)
  })

  it('does not fold when the only turn is the one in progress', () => {
    const { events, nodes } = conversation(1)
    expect(selectFoldRange({ events, nodes, retainTokens: 1 })).toBeNull()
  })

  it('works when the opening turn has no player message', () => {
    seq = 0
    const events: SessionEvent[] = [event('system/message'), event('turn/start', { turn: 1 }), event('assistant/message'), event('tool/result'), event('turn/end', { turn: 1 })]
    events.push(event('turn/start', { turn: 2 }), player('hello'), event('assistant/message'), event('tool/result'))
    const surface = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])
    const nodes = events.filter(entry => surface.has(entry.type)).map(entry => ({ seq: entry.seq, tokens: 100 }))
    const range = selectFoldRange({ events, nodes, retainTokens: 200 })
    expect(range?.uptoTurn).toBe(1)
  })
})
