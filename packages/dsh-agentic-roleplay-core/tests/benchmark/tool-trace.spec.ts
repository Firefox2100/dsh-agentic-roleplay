import { describe, expect, it } from 'vitest'
import type { LogRow } from './helper-logs.ts'
import { toolCallsOf, toolMetrics, toolProblems, type ToolCall } from './tool-trace.ts'

const call = (name: string, args: Record<string, unknown> = {}, error = false): ToolCall => ({ name, args, error })

describe('the calls of a session log', () => {
  it('are read in order, with the ones whose result was an error', () => {
    const rows: LogRow[] = [
      { type: 'tool/call', data: { callId: 'a', name: 'skill', arguments: '{"name":"world-places"}' } },
      { type: 'tool/result', data: { message: { toolCallId: 'a', isError: false } } },
      { type: 'tool/call', data: { callId: 'b', name: 'create_world_element', arguments: { kind: 'location', key: 'x' } } },
      { type: 'tool/result', data: { message: { toolCallId: 'b', isError: true } } },
    ]
    expect(toolCallsOf(rows)).toEqual([call('skill', { name: 'world-places' }), call('create_world_element', { kind: 'location', key: 'x' }, true)])
  })
})

describe('what a run of calls adds up to', () => {
  it('counts failures and the longest run of them', () => {
    const metrics = toolMetrics([call('a'), call('b', {}, true), call('c', {}, true), call('d'), call('e', {}, true)])
    expect(metrics).toMatchObject({ calls: 5, failed: 3, longestFailureRun: 2 })
  })

  it('sees a write whose guide was not loaded first, and not one whose guide was', () => {
    expect(toolMetrics([call('create_world_element', { kind: 'faction', key: 'g' })]).guidesSkipped).toEqual(['world-factions'])
    expect(toolMetrics([call('skill', { name: 'world-factions' }), call('create_world_element', { kind: 'faction', key: 'g' })]).guidesSkipped).toEqual([])
  })

  it('sees a change made by deleting and making again, for an element and for a relationship', () => {
    expect(toolMetrics([call('delete_world_element', { kind: 'character', key: 'a' }), call('create_world_element', { kind: 'character', key: 'a' })]).churn).toBe(1)
    expect(toolMetrics([
      call('edit_world_relationship', { change: { kind: 'character', key: 'character:a:b', remove: true } }),
      call('edit_world_relationship', { change: { kind: 'character', create: true, from: 'a', to: 'b', label: 'x' } }),
    ]).churn).toBe(1)
    expect(toolMetrics([call('edit_world_relationship', { change: { kind: 'character', key: 'character:a:b', label: 'x' } })]).churn).toBe(0)
  })

  it('counts whole-document writes against partial ones, and repeated calls', () => {
    const metrics = toolMetrics([call('replace_world_element'), call('update_world_element', { a: 1 }), call('update_world_element', { a: 1 })])
    expect(metrics).toMatchObject({ whole: 1, partial: 2, repeated: 1 })
  })
})

describe('what a case expects of the calls', () => {
  it('names each thing that is not met', () => {
    const calls = [call('delete_world_element', { kind: 'character', key: 'a' }), call('create_world_element', { kind: 'character', key: 'a' }, true), call('create_world_element', { kind: 'character', key: 'a' }, true)]
    expect(toolProblems([{ type: 'not-used', tool: 'delete_world_element' }, { type: 'max-failures', n: 1 }, { type: 'guide-first', guide: 'world-characters' }, { type: 'used-any', tools: ['update_world_element'] }, { type: 'no-churn' }], calls)).toEqual([
      'delete_world_element was used', '2 calls failed, more than 1', 'world-characters was not loaded before the first write that needs it', 'none of update_world_element was used', 'something was deleted and made again to change it',
    ])
    expect(toolProblems([{ type: 'not-used', tool: 'delete_world_element' }], [call('update_world_element')])).toEqual([])
  })
})
