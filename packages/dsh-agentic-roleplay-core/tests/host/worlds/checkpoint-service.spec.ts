import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { CheckpointBusyError, WorldCheckpoints } from '../../../src/host/worlds/checkpoint-service.ts'
import { checkpointHooks } from '../../../src/host/authoring/checkpoint-tools.ts'

let directory: string
let service: WorldCheckpoints
const problems: string[] = []
const chat = authoringChatSessionId('w1')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'checkpoint-service-'))
  await mkdir(join(directory, 'characters/tam'), { recursive: true })
  await writeFile(join(directory, 'world.json'), '{"id":"w1","name":"Harbour"}')
  await writeFile(join(directory, 'characters/tam/character.json'), '{"name":"Tam"}')
  const ctx = new Context()
  ctx.provide('roleplayWorlds')
  ctx.set('roleplayWorlds', { find: async (id: string) => (id === 'w1' ? { directory } : undefined), list: vi.fn(async () => ({})) })
  service = new WorldCheckpoints(ctx, () => 10, message => { problems.push(message) })
  problems.length = 0
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the checkpoints of a world by its id', () => {
  it('are made on request, listed, compared and restored', async () => {
    const made = await service.make('w1', 'before the rewrite')
    expect(made).toMatchObject({ label: 'before the rewrite', reason: 'manual' })
    await writeFile(join(directory, 'characters/tam/character.json'), '{"name":"Old Tam"}')
    expect((await service.list('w1')).map(each => each.id)).toEqual([made.id])
    expect(await service.diff('w1', made.id)).toEqual({ changed: ['characters/tam/character.json'], added: [], removed: [] })
    expect(await service.read('w1', made.id, 'characters/tam/character.json')).toMatchObject({ text: '{"name":"Tam"}' })
    await service.restore('w1', made.id, false)
    expect(await readFile(join(directory, 'characters/tam/character.json'), 'utf8')).toBe('{"name":"Tam"}')
  })

  it('refuse a restore while the assistant is working, and a world that does not exist', async () => {
    const made = await service.make('w1', '')
    await expect(service.restore('w1', made.id, true)).rejects.toThrow(CheckpointBusyError)
    await expect(service.list('nope')).rejects.toThrow(WorldNotFoundError)
  })

  it('are made once at the first edit of a turn, not for reading, and a failure to make one never stops the edit', async () => {
    await service.beforeEdit(chat, 1, 'replace_world_element')
    await writeFile(join(directory, 'world.json'), '{"id":"w1","name":"Other"}')
    await service.beforeEdit(chat, 1, 'edit_world_info')
    expect(await service.list('w1')).toHaveLength(1)
    await service.beforeEdit(chat, 2, 'edit_world_info')
    expect(await service.list('w1')).toHaveLength(2)
    expect((await service.list('w1'))[0]).toMatchObject({ reason: 'turn', turn: 2, chat })
    await service.beforeEdit('session-not-an-authoring-chat', 1, 'x')
    expect(await service.list('w1')).toHaveLength(2)
    await rm(directory, { recursive: true })
    await service.beforeEdit(chat, 3, 'edit_world_info')
    expect(problems.join(' ')).toMatch(/could not make a checkpoint/)
  })

  it('tell a chat once that the person restored its world', async () => {
    const made = await service.make('w1', 'good state')
    expect(await service.unannouncedRestore(chat)).toBeUndefined()
    await service.restore('w1', made.id, false)
    expect(await service.unannouncedRestore(chat)).toMatchObject({ label: 'good state' })
    expect(await service.unannouncedRestore(chat)).toBeUndefined()
  })
})

describe('the hooks of an authoring chat', () => {
  function installed() {
    const handlers: Record<string, (payload: never, next: () => Promise<unknown>) => Promise<unknown>> = {}
    const ctx = { on: (name: string, handler: (payload: never, next: () => Promise<unknown>) => Promise<unknown>) => { handlers[name] = handler } } as never
    const beforeEdit = vi.fn(async () => undefined)
    const unannouncedRestore = vi.fn(async (): Promise<{ at: string; label: string } | undefined> => undefined)
    checkpointHooks(ctx, () => ({ beforeEdit, unannouncedRestore }) as never, () => 'zh')
    return { handlers, beforeEdit, unannouncedRestore }
  }
  const agent = (id: string, origin = 'root') => ({ session: { id, header: { origin }, snapshotEvents: () => [{ type: 'turn/start', data: { turn: 4 } }] } })

  it('make a checkpoint before an edit tool of an authoring chat, and for nothing else', async () => {
    const { handlers, beforeEdit } = installed()
    const next = async () => ({ kind: 'allow' })
    await handlers['tools/pre-execute']!({ name: 'replace_world_element', agent: agent(chat) } as never, next)
    await handlers['tools/pre-execute']!({ name: 'get_character', agent: agent(chat) } as never, next)
    await handlers['tools/pre-execute']!({ name: 'replace_world_element', agent: agent('session-x') } as never, next)
    await handlers['tools/pre-execute']!({ name: 'replace_world_element', agent: agent(chat, 'subagent') } as never, next)
    expect(beforeEdit).toHaveBeenCalledTimes(1)
    expect(beforeEdit).toHaveBeenCalledWith(chat, expect.any(Number), 'replace_world_element')
  })

  it('tell the chat of a restore at the first step of its next turn', async () => {
    const { handlers, unannouncedRestore } = installed()
    const enter = async () => ({ kind: 'enter', messages: [] })
    expect(await handlers['agent/pre-step']!({ step: 1, agent: agent(chat) } as never, enter)).toMatchObject({ messages: [] })
    unannouncedRestore.mockResolvedValueOnce({ at: '2026-11-17T16:00:00Z', label: 'good state' })
    const told = await handlers['agent/pre-step']!({ step: 1, agent: agent(chat) } as never, enter) as { messages: { content: { text: string }[] }[] }
    expect(told.messages).toHaveLength(1)
    expect(told.messages[0]!.content[0]!.text).toContain('还原到检查点“good state”')
    unannouncedRestore.mockResolvedValueOnce({ at: 'x', label: 'y' })
    expect(await handlers['agent/pre-step']!({ step: 2, agent: agent(chat) } as never, enter)).toMatchObject({ messages: [] })
  })
})
