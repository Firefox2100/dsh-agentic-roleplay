import { describe, expect, it } from 'vitest'
import { fullestRequest, refusalsOf, turnTimes } from '../../../src/client/chat-settings/turn-times.ts'
import type { ActivityEntry } from '../../../src/shared/activity.ts'
import type { TurnTrace } from '../../../src/shared/trace.ts'

const trace: TurnTrace = {
  turn: 4, startedAt: 10_000, endedAt: 70_000, beforeMs: 3000,
  requests: [{ step: 1, prompt: 3000, ms: 8000, stop: 'tool-calls', parts: [{ id: 'system', tokens: 500 }, { id: 'earlier', tokens: 2500 }] }, { step: 2, prompt: 4000, ms: 6000, stop: 'max-tokens', parts: [{ id: 'system', tokens: 500 }, { id: 'steps', tokens: 900 }, { id: 'earlier', tokens: 2600 }] }],
  calls: [{ tool: 'activate_characters', ms: 30_000, failed: false, note: '' }, { tool: 'narrate', ms: 10, failed: true, note: 'The line is twice.' }, { tool: 'narrate', ms: 20, failed: false, note: '' }],
  steered: ['You may not end the turn yet.'],
}
const run = (label: string, at: number, ms: number, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at, label, model: '', ms, calls: 1, turn: 4, ...extra })

describe('where a turn\'s time went', () => {
  it('splits a helper\'s run at delivery into what the player waited for and what ran on', () => {
    const times = turnTimes(trace, [run('Clara', 50_000, 20_000), run('record keeper', 100_000, 60_000, { refused: 2 }), run('Other turn', 90_000, 5000, { turn: 5 })])
    expect(times).toMatchObject({ foregroundMs: 60_000, beforeMs: 3000, modelMs: 14_000, backgroundMs: 30_000 })
    expect(times.helpers).toEqual([
      { label: 'record keeper', foregroundMs: 30_000, backgroundMs: 30_000, runs: 1, refused: 2 },
      { label: 'Clara', foregroundMs: 20_000, backgroundMs: 0, runs: 1, refused: 0 },
    ])
  })

  it('totals the tool calls by name, longest first', () => {
    expect(turnTimes(trace, []).tools).toEqual([{ tool: 'activate_characters', ms: 30_000, calls: 1 }, { tool: 'narrate', ms: 30, calls: 2 }])
  })

  it('has no foreground time for a turn that has not ended', () => {
    expect(turnTimes({ turn: 4, startedAt: 10_000 }, [run('Clara', 20_000, 5000)])).toMatchObject({ foregroundMs: 0, backgroundMs: 0, helpers: [expect.objectContaining({ foregroundMs: 5000, backgroundMs: 0 })] })
  })
})

describe('what the harness refused', () => {
  it('collects refused calls, its own messages, helpers with refused calls and requests cut off at the limit', () => {
    const times = turnTimes(trace, [run('record keeper', 100_000, 60_000, { refused: 2 })])
    expect(refusalsOf(trace, times.helpers)).toEqual({ calls: [{ tool: 'narrate', note: 'The line is twice.' }], steered: ['You may not end the turn yet.'], helpers: [{ label: 'record keeper', refused: 2 }], cutOff: [2] })
  })
})

describe('the fullest request', () => {
  it('is the one with the biggest prompt, its parts largest first', () => {
    expect(fullestRequest(trace)).toEqual({ prompt: 4000, step: 2, parts: [{ id: 'earlier', tokens: 2600 }, { id: 'steps', tokens: 900 }, { id: 'system', tokens: 500 }] })
    expect(fullestRequest({ turn: 1, startedAt: 0 })).toBeUndefined()
  })
})
