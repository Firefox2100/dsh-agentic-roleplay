import { describe, expect, it } from 'vitest'
import { cutOff, finishOf } from '../../../src/host/agents/cut-off.ts'
import { guardAuthoringTurns } from '../../../src/host/authoring/turn-guard.ts'

const finish = (kind: string) => ({ chunk: { type: 'finish', reason: { kind } } })

/** An agent whose replies ended as `kinds` say, the last one last. */
function agentOf(kinds: string[], origin = 'root', efforts: string[] = ['off', 'high']) {
  const steered: string[] = []
  const cancelled: unknown[] = []
  const events = kinds.map(kind => ({ type: 'assistant/message', data: { stream: [{ chunk: { type: 'text' } }, finish(kind)] } }))
  const agent = {
    session: { id: 'chat', header: { origin }, snapshotEvents: () => events },
    steer: (message: { content: { text: string }[] }) => { steered.push(message.content[0]!.text) },
    cancel: (reason: unknown) => { cancelled.push(reason) },
    ctx: { llm: { resolveModelInfo: () => Promise.resolve({ reasoning: { efforts: efforts.map(id => ({ id })) } }) } },
  }
  return { steered, cancelled, events, agent: agent as never }
}

function installed(language: string | null = 'zh', level = '') {
  const handlers: Record<string, (payload: never, next?: () => Promise<unknown>) => unknown> = {}
  const ctx = { on: (name: string, handler: (payload: never, next?: () => Promise<unknown>) => unknown) => { handlers[name] = handler } } as never
  guardAuthoringTurns(ctx, () => ({ text: (id: string, lang: string) => `${id}:${lang}` }) as never, () => language ?? undefined, () => level)
  return {
    call: async (agent: never, name: string, args: object) => await handlers['tools/pre-execute']!({ agent, name, arguments: args } as never, () => Promise.resolve({ kind: 'allow' })) as { kind: string; reason?: string },
    step: async (agent: never, step: number) => await handlers['agent/pre-step']!({ agent, step } as never, () => Promise.resolve({ kind: 'enter' })),
    stop: (agent: never, turn = 1) => { handlers['agent/turn-stopping']!({ agent, turn } as never) },
    request: async (agent: never, config: object) => await handlers['agent/request']!({ agent, signal: new AbortController().signal } as never, () => Promise.resolve(config)) as { reasoningEffort?: string },
  }
}

describe('a reply that ran out of room', () => {
  it('is told from one that ended any other way', () => {
    expect(cutOff(agentOf(['max-tokens']).agent)).toBe(true)
    expect(cutOff(agentOf(['stop']).agent)).toBe(false)
    expect(finishOf(agentOf([]).agent)).toBeUndefined()
    expect(finishOf(agentOf(['stop', 'tool-calls']).agent)).toBe('tool-calls')
  })

  it('steers the turn back, in the chat\'s language, and again at each stop until the assistant finishes by itself', () => {
    const { stop } = installed()
    const { agent, steered, events } = agentOf(['max-tokens'])
    stop(agent)
    events.push({ type: 'assistant/message', data: { stream: [finish('tool-calls')] } })
    stop(agent)
    events.push({ type: 'assistant/message', data: { stream: [finish('stop')] } })
    stop(agent)
    expect(steered).toEqual(['import/cut-off:zh', 'import/cut-off:zh'])
  })

  it('gives up after a few tries', () => {
    const { stop } = installed()
    const { agent, steered } = agentOf(['max-tokens'])
    for (let attempt = 0; attempt < 10; attempt += 1) stop(agent)
    expect(steered).toHaveLength(6)
  })

  it('leaves alone a turn that ended well, a helper, and a chat that is not an authoring chat', () => {
    const { stop } = installed()
    const fine = agentOf(['stop'])
    const helper = agentOf(['max-tokens'], 'subagent')
    stop(fine.agent); stop(helper.agent)
    const elsewhere = agentOf(['max-tokens'])
    installed(null).stop(elsewhere.agent)
    expect([...fine.steered, ...helper.steered, ...elsewhere.steered]).toEqual([])
  })
})

describe('the thinking level of an authoring assistant', () => {
  const config = { provider: 'p', model: 'm', reasoningEffort: 'high' }

  it('is the one in the settings when the model offers it', async () => {
    expect(await installed('en', 'off').request(agentOf([]).agent, config)).toMatchObject({ reasoningEffort: 'off' })
  })

  it('stays the chat\'s own when the settings name none, the model lacks the level, or the agent is a helper or not an authoring chat', async () => {
    expect(await installed('en', '').request(agentOf([]).agent, config)).toBe(config)
    expect(await installed('en', 'off').request(agentOf([], 'root', ['high']).agent, config)).toBe(config)
    expect(await installed('en', 'off').request(agentOf([], 'subagent').agent, config)).toBe(config)
    expect(await installed(null, 'off').request(agentOf([]).agent, config)).toBe(config)
  })
})

describe('a call made again and again', () => {
  it('is let through three times in a turn and refused after that, with the language of the chat; a different call or a new turn starts again', async () => {
    const { call, step } = installed('zh')
    const { agent } = agentOf([])
    const same = { change: { create: true, label: 'x' } }
    for (let n = 0; n < 3; n += 1) expect((await call(agent, 'edit_world_relationship', same)).kind).toBe('allow')
    const refused = await call(agent, 'edit_world_relationship', same)
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('3')
    expect((await call(agent, 'edit_world_relationship', { change: { create: true, label: 'y' } })).kind).toBe('allow')
    await step(agent, 2)
    expect((await call(agent, 'edit_world_relationship', same)).kind).toBe('deny')
    await step(agent, 1)
    expect((await call(agent, 'edit_world_relationship', same)).kind).toBe('allow')
  })

  it('ends the turn when the assistant goes on after being refused five times', async () => {
    const { agent, cancelled } = agentOf([])
    const { call } = installed('en')
    for (let n = 1; n <= 3 + 5; n += 1) await call(agent, 'create_world_element', { key: 'rv' })
    expect(cancelled).toEqual([])
    const refused = await call(agent, 'create_world_element', { key: 'rv' })
    expect(refused.kind).toBe('deny')
    expect(cancelled).toEqual([{ kind: 'user' }])
  })

  it('is left alone in a chat that is not an authoring chat, and in a helper', async () => {
    const none = installed(null)
    for (let n = 0; n < 6; n += 1) expect((await none.call(agentOf([]).agent, 'x', {})).kind).toBe('allow')
    const helper = installed('zh')
    for (let n = 0; n < 6; n += 1) expect((await helper.call(agentOf([], 'subagent').agent, 'x', {})).kind).toBe('allow')
  })
})
