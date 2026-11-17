import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkpointHooks, checkpointTools, registerCheckpointTools } from '../../../src/host/authoring/checkpoint-tools.ts'
import * as authoring from '../../../src/authoring.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import type { WorldCheckpoints } from '../../../src/host/worlds/checkpoint-service.ts'

let directory: string

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'checkpoint-tools-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const catalog = {
  find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary: { id: 'harbor', name: 'Harbor', description: 'A fogbound port.', tags: [] } } : undefined),
} as unknown as WorldCatalog

const exec = (chat = authoringChatSessionId('harbor'), origin: string | undefined = undefined) => ({
  agent: { session: { id: chat, header: { origin }, snapshotEvents: () => [] } },
  signal: new AbortController().signal,
})

const chat = authoringChatSessionId('harbor')
const checkpoint = { id: '2026-01-01T00:00:00.000Z-0001', at: '2026-01-01T00:00:00.000Z', label: 'before an edit' }

function service(overrides: Partial<WorldCheckpoints> = {}): WorldCheckpoints {
  return {
    list: () => Promise.resolve([checkpoint]),
    make: () => Promise.resolve(checkpoint),
    diff: () => Promise.resolve({ changed: ['world.json'], added: [], removed: [] }),
    read: () => Promise.resolve({ path: 'world.json', text: '{}' }),
    restore: () => Promise.resolve(),
    beforeEdit: () => Promise.resolve(),
    unannouncedRestore: () => Promise.resolve(undefined),
    ...overrides,
  } as unknown as WorldCheckpoints
}

describe('the checkpoint tools of the authoring preset', () => {
  it('reads the checkpoints of the world the chat is authoring', async () => {
    const tools = checkpointTools(catalog, () => service())
    const list = tools.find(tool => tool.name === 'list_world_checkpoints')!
    const diff = tools.find(tool => tool.name === 'diff_world_checkpoint')!
    const read = tools.find(tool => tool.name === 'read_world_checkpoint_file')!

    expect(list.isConcurrencySafe?.({} as never)).toBe(true)
    expect(diff.isConcurrencySafe?.({ checkpoint: checkpoint.id } as never), 'reading a checkpoint may run beside other reads').toBe(true)
    expect(read.isConcurrencySafe?.({ checkpoint: checkpoint.id, path: 'world.json' } as never), 'reading one file of a checkpoint may run beside other reads').toBe(true)
    expect(await list.execute({} as never, exec() as never)).toEqual({ checkpoints: [checkpoint] })
    expect(await diff.execute({ checkpoint: checkpoint.id } as never, exec() as never)).toEqual({ changed: ['world.json'], added: [], removed: [] })
    expect(await read.execute({ checkpoint: checkpoint.id, path: 'world.json' } as never, exec() as never)).toEqual({ path: 'world.json', text: '{}' })
  })

  it('takes a checkpoint at the first edit of a turn, and not when nothing is being written', async () => {
    const asked: { chat: string; turn: unknown; tool: string }[] = []
    let listener: ((exec: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
    const ctx = { on: (name: string, handler: typeof listener) => { if (name === 'tools/pre-execute') listener = handler } } as never
    checkpointHooks(ctx, () => service({
      beforeEdit: (chat: string, turn: unknown, tool: string) => { asked.push({ chat, turn, tool }); return Promise.resolve() },
    }), () => 'en')

    expect(listener).toBeDefined()
    const next = () => Promise.resolve('went on')
    expect(await listener!({ name: 'write_world_file', agent: exec().agent }, next)).toBe('went on')
    expect(asked).toEqual([{ chat, turn: 0, tool: 'write_world_file' }])

    asked.length = 0
    await listener!({ name: 'read_world_info', agent: exec().agent }, next)
    await listener!({ name: 'write_world_file', agent: exec(chat, 'subagent').agent }, next)
    await listener!({ name: 'write_world_file', agent: exec('session-elsewhere').agent }, next)
    expect(asked).toEqual([])
  })

  it('tells the chat once when the person restored the world since it last looked', async () => {
    let listener: ((payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
    let asked = 0
    const ctx = { on: (name: string, handler: typeof listener) => { if (name === 'agent/pre-step') listener = handler } } as never
    checkpointHooks(ctx, () => service({
      unannouncedRestore: () => { asked += 1; return Promise.resolve(checkpoint) },
    }), () => 'en')

    const decision = { kind: 'enter', messages: [] as unknown[] }
    const first = await listener!({ step: 1, agent: exec().agent }, () => Promise.resolve(decision)) as { messages: { content: { text: string }[] }[] }
    expect(asked).toBe(1)
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0]!.content[0]!.text).toContain('before an edit')
    expect(first.messages[0]!.content[0]!.text).toContain('2026-01-01T00:00:00.000Z')

    expect(await listener!({ step: 2, agent: exec().agent }, () => Promise.resolve(decision))).toBe(decision)
    expect(await listener!({ step: 1, agent: exec(chat, 'subagent').agent }, () => Promise.resolve(decision))).toBe(decision)
    expect(asked).toBe(1)
  })

  it('leaves the turn alone when nothing was restored or the model did not enter', async () => {
    let listener: ((payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
    const ctx = { on: (name: string, handler: typeof listener) => { if (name === 'agent/pre-step') listener = handler } } as never
    checkpointHooks(ctx, () => service(), () => 'en')

    const refusal = { kind: 'refuse', messages: [] as unknown[] }
    expect(await listener!({ step: 1, agent: exec().agent }, () => Promise.resolve(refusal))).toBe(refusal)
    const entered = { kind: 'enter', messages: [] as unknown[] }
    expect(await listener!({ step: 1, agent: exec().agent }, () => Promise.resolve(entered))).toBe(entered)
  })

  it('registers its tools and hooks on the scope of the preset that authors a world', async () => {
    const registered: string[] = []
    const handlers = new Map<string, unknown>()
    const ctx = {
      roleplayWorlds: catalog,
      roleplayCheckpoints: service({ unannouncedRestore: () => Promise.resolve(checkpoint) }),
      roleplayAuthoringLanguages: { get: () => 'en' },
      tools: { register: (tool: { name: string }) => { registered.push(tool.name) } },
      on: (name: string, handler: unknown) => { handlers.set(name, handler) },
    } as unknown as Parameters<typeof registerCheckpointTools>[0]

    registerCheckpointTools(ctx)
    expect(registered).toEqual(['list_world_checkpoints', 'diff_world_checkpoint', 'read_world_checkpoint_file'])
    expect([...handlers.keys()]).toEqual(['tools/pre-execute', 'agent/pre-step'])

    const step = handlers.get('agent/pre-step') as (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>
    const decision = await step({ step: 1, agent: exec().agent }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const messages = (decision as { messages: { content: { text: string }[] }[] }).messages
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content[0]!.text).toContain('before an edit')
  })

  it('declares the services the preset reads, so the loader starts it only when they exist', () => {
    expect(authoring.inject).toContain('roleplayCheckpoints')
    expect(authoring.inject).toContain('tools')
    expect(authoring.inject).toContain('roleplayWorlds')
  })
})
