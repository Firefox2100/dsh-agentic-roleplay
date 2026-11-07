import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { RunawayThinking } from '../../../src/host/orchestration/runaway.ts'

function agentOf(finish: string, efforts: string[], effort = 'high') {
  let selected: Record<string, unknown> = { provider: 'p', model: 'm', reasoningEffort: effort }
  const selections: Record<string, unknown>[] = []
  const agent = {
    session: { snapshotEvents: () => [{ type: 'assistant/message', data: { stream: [{ chunk: { type: 'finish', reason: { kind: finish } } }] } }] },
    model: { current: () => selected, select: (next: Record<string, unknown>) => { selected = next; selections.push(next) } },
    ctx: { llm: { resolveModelInfo: async () => ({ reasoning: { efforts: efforts.map(id => ({ id })) } }) } },
  } as unknown as Agent
  return { agent, selections, selected: () => selected }
}

describe('a game master whose thinking ran to the end of its output limit', () => {
  it('answers without thinking for the rest of the turn, and has its level back at the next turn', async () => {
    const { agent, selections } = agentOf('max-tokens', ['off', 'high'])
    const runaway = new RunawayThinking()
    await runaway.step('chat', agent, 2)
    expect(selections).toEqual([{ provider: 'p', model: 'm', reasoningEffort: 'off' }])
    await runaway.step('chat', agent, 3)
    expect(selections).toHaveLength(1)
    await runaway.step('chat', agent, 1)
    expect(selections.at(-1)).toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('is left alone when it was not cut off, is on its first step, or its model cannot think less', async () => {
    const quiet = agentOf('tool-calls', ['off', 'high'])
    await new RunawayThinking().step('chat', quiet.agent, 2)
    const first = agentOf('max-tokens', ['off', 'high'])
    await new RunawayThinking().step('chat', first.agent, 1)
    const fixed = agentOf('max-tokens', ['high'])
    await new RunawayThinking().step('chat', fixed.agent, 2)
    const already = agentOf('max-tokens', ['off', 'high'], 'off')
    await new RunawayThinking().step('chat', already.agent, 2)
    expect([quiet, first, fixed, already].map(entry => entry.selections.length)).toEqual([0, 0, 0, 0])
  })
})
