import { describe, expect, it } from 'vitest'
import { cutOff, finishOf } from '../../../src/host/agents/cut-off.ts'
import { guideOf } from '../../../src/host/authoring/guides.ts'
import { guardAuthoringTurns } from '../../../src/host/authoring/turn-guard.ts'

const finish = (kind: string) => ({ chunk: { type: 'finish', reason: { kind } } })

/** An agent whose replies ended as `kinds` say, the last one last. */
function agentOf(kinds: string[], origin = 'root', efforts: string[] = ['off', 'high']) {
  const steered: string[] = []
  const cancelled: unknown[] = []
  const selected: unknown[] = []
  const events = kinds.map(kind => ({ type: 'assistant/message', data: { stream: [{ chunk: { type: 'text' } }, finish(kind)] } }))
  const agent = {
    session: { id: 'chat', header: { origin }, snapshotEvents: () => events },
    steer: (message: { content: { text: string }[] }) => { steered.push(message.content[0]!.text) },
    cancel: (reason: unknown) => { cancelled.push(reason) },
    model: {
      current: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
      select: (selection: unknown) => { selected.push(selection) },
    },
    ctx: { llm: { resolveModelInfo: () => Promise.resolve({ reasoning: { efforts: efforts.map(id => ({ id })) } }) } },
  }
  return { steered, cancelled, events, selected, agent: agent as never }
}

function installed(language: string | null = 'zh', level = '') {
  const handlers: Record<string, (payload: never, next?: () => Promise<unknown>) => unknown> = {}
  const ctx = { on: (name: string, handler: (payload: never, next?: () => Promise<unknown>) => unknown) => { handlers[name] = handler } } as never
  guardAuthoringTurns(ctx, () => ({ text: (id: string, lang: string) => `${id}:${lang}` }) as never, () => language ?? undefined, () => level)
  return {
    call: async (agent: never, name: string, args: object) => await handlers['tools/pre-execute']!({ agent, name, arguments: args } as never, () => Promise.resolve({ kind: 'allow' })) as { kind: string; reason?: string },
    result: (agent: never, name: string, isError: boolean) => { handlers['tools/result']!({ agent, name } as never, { isError } as never) },
    step: async (agent: never, step: number) => await handlers['agent/pre-step']!({ agent, step } as never, () => Promise.resolve({ kind: 'enter' })),
    stop: (agent: never, turn = 1) => { handlers['agent/turn-stopping']!({ agent, turn } as never) },
    created: async (agent: never) => await handlers['agent/created']!({ agent, signal: new AbortController().signal } as never),
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

  it('is told differently, and then stopped, when the cut-off reply went round in circles', () => {
    const { stop } = installed()
    const { agent, steered, cancelled, events } = agentOf(['max-tokens'])
    const lap = Array.from({ length: 14 }, (_, n) => `Let me check entry ${n % 3} once more to be sure.`).join('\n')
    events[0] = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: lap }] }, stream: [finish('max-tokens')] } } as never
    stop(agent)
    expect(steered).toEqual(['import/repeating:zh'])
    stop(agent)
    expect(steered).toHaveLength(1)
    expect(cancelled).toHaveLength(1)
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
  it('is the one in the settings when the model offers it', async () => {
    const candidate = agentOf([])
    await installed('en', 'off').created(candidate.agent)
    expect(candidate.selected).toEqual([{ provider: 'p', model: 'm', reasoningEffort: 'off' }])
  })

  it('stays the chat\'s own when the settings name none, the model lacks the level, or the agent is a helper or not an authoring chat', async () => {
    const candidates = [agentOf([]), agentOf([], 'root', ['high']), agentOf([], 'subagent'), agentOf([])]
    await installed('en', '').created(candidates[0]!.agent)
    await installed('en', 'off').created(candidates[1]!.agent)
    await installed('en', 'off').created(candidates[2]!.agent)
    await installed(null, 'off').created(candidates[3]!.agent)
    expect(candidates.flatMap(candidate => candidate.selected)).toEqual([])
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

  it('is refused for the rest of the turn once it failed six times in a row, whatever the arguments (a model walking through ids that do not exist)', async () => {
    const { call, result, step } = installed('en')
    const { agent, cancelled } = agentOf([])
    for (let id = 132; id < 138; id += 1) {
      expect((await call(agent, 'card_read', { piece: `entry:${id}` })).kind).toBe('allow')
      result(agent, 'card_read', true)
    }
    const refused = await call(agent, 'card_read', { piece: 'entry:138' })
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('card_read')
    expect((await call(agent, 'card_search', { query: 'x' })).kind).toBe('allow')
    expect(cancelled).toEqual([])
    for (let n = 0; n < 4; n += 1) await call(agent, 'card_read', { piece: `entry:${200 + n}` })
    expect(cancelled).toEqual([])
    await call(agent, 'card_read', { piece: 'entry:999' })
    expect(cancelled).toEqual([{ kind: 'user' }])
    await step(agent, 1)
    expect((await call(agent, 'card_read', { piece: 'entry:1' })).kind).toBe('allow')
  })

  it('does not count failures a success breaks up, or those of other tools', async () => {
    const { call, result } = installed('en')
    const { agent } = agentOf([])
    for (let id = 0; id < 30; id += 1) {
      expect((await call(agent, 'card_read', { piece: `entry:${id}` })).kind).toBe('allow')
      result(agent, 'card_read', id % 4 !== 3)
    }
    for (let id = 0; id < 10; id += 1) { await call(agent, 'card_search', { query: `q${id}` }); result(agent, 'card_search', true) }
    expect((await call(agent, 'card_read', { piece: 'entry:1000' })).kind).toBe('allow')
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

describe('a tool that keeps failing and has a format guide', () => {
  const fail = async (guard: ReturnType<typeof installed>, agent: never, args: object, name = 'create_world_element') => {
    const decision = await guard.call(agent, name, args)
    if (decision.kind === 'allow') guard.result(agent, name, true)
    return decision
  }

  it('is refused once, with the guide named, until the guide is loaded', async () => {
    const guard = installed()
    const { agent } = agentOf([])
    await guard.step(agent, 1)
    expect((await fail(guard, agent, { kind: 'location', key: 'a' })).kind).toBe('allow')
    expect((await fail(guard, agent, { kind: 'location', key: 'b' })).kind).toBe('allow')
    const pointed = await fail(guard, agent, { kind: 'location', key: 'c' })
    expect(pointed.kind).toBe('deny')
    expect(pointed.reason).toContain('world-places')
    expect((await fail(guard, agent, { kind: 'location', key: 'd' })).kind).toBe('allow')
  })

  it('is not pointed at the guide when the guide was loaded', async () => {
    const guard = installed()
    const { agent } = agentOf([])
    await guard.step(agent, 1)
    await guard.call(agent, 'skill', { name: 'world-places' })
    for (const key of ['a', 'b', 'c']) expect((await fail(guard, agent, { kind: 'location', key })).kind).toBe('allow')
  })

  it('names the guide when it is stopped for the rest of the turn', async () => {
    const guard = installed()
    const { agent } = agentOf([])
    await guard.step(agent, 1)
    await guard.call(agent, 'skill', { name: 'world-places' })
    for (let n = 0; n < 6; n += 1) await fail(guard, agent, { kind: 'location', key: `k${n}` })
    const stopped = await fail(guard, agent, { kind: 'location', key: 'z' })
    expect(stopped.kind).toBe('deny')
    expect(stopped.reason).toContain('world-places')
  })
})

describe('guideOf', () => {
  it('names the guide of the kind a tool writes, and nothing for a tool no guide covers', () => {
    expect(guideOf({ name: 'create_world_element', arguments: { kind: 'location' } })).toBe('world-places')
    expect(guideOf({ name: 'write_world_file', arguments: { kind: 'dice' } })).toBe('world-dice')
    expect(guideOf({ name: 'write_world_trigger', arguments: {} })).toBe('world-triggers')
    expect(guideOf({ name: 'list_characters', arguments: {} })).toBeUndefined()
    expect(guideOf({ name: 'create_world_element', arguments: { kind: 'unknown' } })).toBeUndefined()
  })
})
