import { describe, expect, it } from 'vitest'
import { childIds, helperTotals, summariseHelper, type LogRow } from './helper-logs.ts'

const rows = (ended: unknown, calls: { name: string; error?: boolean }[]): LogRow[] => [
  { type: 'subagent/descriptor', data: { agentModel: 'm1' } },
  { type: 'request/header', time: 10, data: { header: { config: { model: 'm1', maxTokens: 800, reasoningEffort: 'off' }, tools: [{ name: 'edit_records' }, { name: 'submit_result' }] } } },
  { type: 'system/message', data: { message: { content: [{ type: 'text', text: 'You are an AI agent powered by DeepSeek Harness.\n\nYou keep the story\'s records.\nMore.' }] } } },
  { type: 'user/message', data: { content: [{ type: 'text', text: 'Write down round 1.' }] } },
  { type: 'assistant/message', time: 20, data: { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'ok' }] } } },
  ...calls.flatMap((call, index): LogRow[] => [
    { type: 'tool/call', time: 30 + index, data: { callId: `c${index}`, name: call.name, arguments: '{"a":1}' } },
    { type: 'tool/result', time: 31 + index, data: { message: { toolCallId: `c${index}`, isError: call.error === true, content: [{ type: 'text', text: call.error === true ? 'refused' : 'done' }] } } },
  ]),
  ...ended === undefined ? [] : [{ type: 'turn/end', time: 100, data: { reason: ended } }],
]

describe('reading a helper from its own log', () => {
  it('says what it was, what it did and whether it handed back a result', () => {
    const run = summariseHelper('h1', rows({ kind: 'completed' }, [{ name: 'edit_records', error: true }, { name: 'edit_records' }, { name: 'submit_result' }]))
    expect(run).toMatchObject({ id: 'h1', model: 'm1', effort: 'off', maxTokens: 800, tools: ['edit_records', 'submit_result'], role: 'You keep the story\'s records.', brief: 'Write down round 1.', ended: 'completed', submitted: true, refusals: 1, ms: 90 })
    expect(run.problem).toBeUndefined()
    expect(run.steps.map(step => step.kind)).toEqual(['thinking', 'text', 'call', 'result', 'call', 'result', 'call', 'result'])
  })

  it('names the problem of a helper that ended badly or never handed back a result', () => {
    expect(summariseHelper('h2', rows({ kind: 'completed' }, [{ name: 'edit_records' }])).problem).toMatch(/without handing back a result/)
    expect(summariseHelper('h3', rows({ kind: 'max-tokens' }, [])).problem).toBe('ended: max-tokens')
    expect(summariseHelper('h4', rows(undefined, [])).problem).toBeUndefined()
    expect(summariseHelper('h4', rows(undefined, [])).ended).toBe('never finished')
  })

  it('does not hold a helper with a constrained reply (no submit_result tool) to handing back a result', () => {
    const structured = rows({ kind: 'completed' }, []).map(row => (row.type === 'request/header' ? { ...row, data: { header: { config: {}, tools: [] } } } : row))
    expect(summariseHelper('h5', structured).problem).toBeUndefined()
  })

  it('finds the helpers a chat started and adds them up by kind', () => {
    expect(childIds([{ type: 'subagent/catalog', data: { childId: 'a' } }, { type: 'user/message' }, { type: 'subagent/catalog', data: { childId: 'b' } }])).toEqual(['a', 'b'])
    const totals = helperTotals([summariseHelper('h1', rows({ kind: 'completed' }, [{ name: 'submit_result' }])), summariseHelper('h2', rows({ kind: 'max-tokens' }, []))])
    expect(totals).toMatchObject({ count: 2, failed: 1, byRole: { 'You keep the story\'s records.': { count: 2, failed: 1 } } })
  })
})
