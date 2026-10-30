import { describe, expect, it } from 'vitest'
import { childSamplingOf, helpers, repairedJson, runChild, structuredReply } from '../../../src/host/agents/child.ts'

const schema = { type: 'object', properties: { roles: { type: 'array', items: { type: 'string' } } }, required: ['roles'], additionalProperties: false } as never

interface Seen { steered: string[]; sampling?: unknown; registered: string[]; persona?: string }

const reply = (text: string) => ({ type: 'assistant/message', data: { stream: [], turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text }] } } })

/** A parent whose child answers with the given replies, one at each time its turn is about to stop. */
function parentAnswering(replies: string[], seen: Seen) {
  return {
    session: { snapshotEvents: () => [] },
    ctx: {
      get: () => ({
        startActivation: async ({ childId }: { childId: string }) => {
          const entry = helpers.get(childId)!
          seen.sampling = childSamplingOf(childId)
          seen.persona = entry.persona
          const events: unknown[] = []
          const handlers: Record<string, () => void> = {}
          const child = {
            session: { snapshotEvents: () => events },
            steer: (message: { content: { text: string }[] }) => { seen.steered.push(message.content[0]!.text) },
            cancel: () => undefined,
            ctx: { tools: { restrict: () => undefined, register: (tool: { name: string }) => { seen.registered.push(tool.name); return () => undefined }, guard: () => undefined }, on: (name: string, handler: () => void) => { handlers[name] = handler } },
          }
          entry.setup(child as never)
          return {
            result: (async () => { for (const text of replies) { events.push(reply(text)); handlers['agent/turn-stopping']!() } })(),
            dispose: () => Promise.resolve(),
          }
        },
      }),
    },
  } as never
}

const task = (parent: never, extra: object = {}) => ({ parent, signal: new AbortController().signal, persona: 'persona', prompt: 'question', result: schema, structured: true, sampling: { temperature: 0.2, toolChoice: 'required' as const }, ...extra })

describe('a helper that answers with a constrained reply', () => {
  it('has no tool to call, asks the endpoint for the schema, and takes the reply as its result', async () => {
    const seen: Seen = { steered: [], registered: [] }
    const result = await runChild<{ roles: string[] }>(task(parentAnswering(['{"roles":["character"]}'], seen)))
    expect(result).toEqual({ roles: ['character'] })
    expect(seen.registered).toEqual([])
    expect(seen.persona).toContain('Your whole reply is the result')
    expect(seen.sampling).toMatchObject({ temperature: 0.2, body: { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } } } })
    expect((seen.sampling as { toolChoice?: string }).toolChoice).toBeUndefined()
  })

  it('is sent back with the reason when the reply is not JSON, does not fit the schema, or is refused by the caller, and gives up after a few', async () => {
    const seen: Seen = { steered: [], registered: [] }
    const result = await runChild<{ roles: string[] }>(task(parentAnswering(['not json', '{"roles":"character"}', '```json\n{"roles":["place"]}\n```', '{"roles":["character"]}'], seen), { beforeSubmit: (value: { roles: string[] }) => (value.roles[0] === 'place' ? 'a place is not wanted' : undefined) }))
    expect(result).toEqual({ roles: ['character'] })
    expect(seen.steered).toHaveLength(3)
    expect(seen.steered[0]).toMatch(/not valid JSON/)
    expect(seen.steered[2]).toContain('a place is not wanted')
    const hopeless = { steered: [] as string[], registered: [] as string[] }
    await expect(runChild(task(parentAnswering(Array.from({ length: 8 }, () => 'nope'), hopeless)))).rejects.toThrow(/refused \d+ times/)
  })

  it('takes a whole reply that ran to the limit as the result, and stops a child whose reply was cut short', async () => {
    const reachedLimit = (text: string) => ({ type: 'assistant/message', data: { stream: [{ chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }], turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
    const answering = (text: string) => ({
      session: { snapshotEvents: () => [] },
      ctx: { get: () => ({ startActivation: async ({ childId }: { childId: string }) => {
        const events: unknown[] = []
        const handlers: Record<string, () => void> = {}
        let stopped = false
        const child = { session: { snapshotEvents: () => events }, steer: () => undefined, cancel: () => { stopped = true }, ctx: { tools: { restrict: () => undefined, register: () => () => undefined, guard: () => undefined }, on: (name: string, handler: () => void) => { handlers[name] = handler } } }
        helpers.get(childId)!.setup(child as never)
        events.push(reachedLimit(text))
        handlers['agent/turn-stopping']!()
        return { result: stopped ? Promise.reject(new Error('stopped')) : Promise.resolve(undefined), dispose: () => Promise.resolve() }
      } }) },
    }) as never
    expect(await runChild<{ roles: string[] }>(task(answering('{"roles":["character"]}')))).toEqual({ roles: ['character'] })
    await expect(runChild(task(answering('{"roles":["charac')))).rejects.toThrow(/up to the limit/)
  })

  it('reads the last reply of the child, ignoring its reasoning', () => {
    const child = { session: { snapshotEvents: () => [reply('{"roles":[]}'), reply('{"roles":["a"]}')] } } as never
    expect(structuredReply(child, schema)).toEqual({ value: { roles: ['a'] } })
    expect(structuredReply({ session: { snapshotEvents: () => [] } } as never, schema)).toEqual({ problem: 'the reply is empty' })
  })
})

describe('a reply that was cut off in the middle of a list', () => {
  it('is closed after the last whole entry, and nothing is made of text that no cut makes JSON', () => {
    expect(JSON.parse(repairedJson('{"left_out":["a"],"variables":[{"key":"x","n":{"a":1}},{"key":"y","na')!)).toEqual({ left_out: ['a'], variables: [{ key: 'x', n: { a: 1 } }] })
    expect(JSON.parse(repairedJson('{"roles":["a","b"')!)).toEqual({ roles: ['a'] } as never)
    expect(repairedJson('not json at all')).toBeUndefined()
    expect(repairedJson('{"a": "unterminated')).toBeUndefined()
  })
})

describe('a reply cut off inside the last entry of a long list', () => {
  const listSchema = { type: 'object', properties: { left_out: { type: 'array', items: { type: 'string' } }, variables: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, only: { type: 'array', items: { type: 'string' } }, options: { type: 'array', items: { type: 'string' } } }, required: ['key', 'only', 'options'] } } }, required: ['left_out', 'variables'] } as never

  it('is closed after the last entry that is whole, not after a list inside the half-written one', () => {
    const text = '{"left_out":["a"],"variables":[{"key":"x","only":[],"options":[]},{"key":"y","only":[],"options":[]},{"key":"z","only":[],"op'
    const child = { session: { snapshotEvents: () => [reply(text)] } } as never
    const mended = structuredReply(child, listSchema, true)
    expect(mended).toEqual({ value: { left_out: ['a'], variables: [{ key: 'x', only: [], options: [] }, { key: 'y', only: [], options: [] }] } })
    const halfWithEmptyList = '{"left_out":[],"variables":[{"key":"x","only":[],"options":[]},{"key":"y","only":[],'
    expect(structuredReply({ session: { snapshotEvents: () => [reply(halfWithEmptyList)] } } as never, listSchema, true)).toEqual({ value: { left_out: [], variables: [{ key: 'x', only: [], options: [] }] } })
  })
})
