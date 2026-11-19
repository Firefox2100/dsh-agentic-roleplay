import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoredWorldWriteTools, authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'

const exec = (name: string, chat = authoringChatSessionId('harbor'), args: Record<string, unknown> = {}) => ({ name, arguments: args, agent: { session: { id: chat } } }) as never

describe('world authoring approval gate', () => {
  it('sends back a relationship change the tool would refuse, without asking the person, and asks for one that holds', async () => {
    const next = vi.fn()
    const objects = { change: { create: true, kind: 'character', from: { kind: 'character', key: 'a' }, to: { kind: 'character', key: 'b' }, label: 'father' } }
    await expect(authoringApproval(exec('edit_world_relationship', undefined, objects), next)).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('from is needed: the key of the entity, written as plain text') })
    const plain = { change: { create: true, kind: 'character', from: 'a', to: 'b', label: 'father' } }
    await expect(authoringApproval(exec('edit_world_relationship', undefined, plain), next)).resolves.toMatchObject({ kind: 'ask' })
  })

  it('asks once for every mutation in an authoring chat', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('delete_world_element', undefined, { kind: 'character', key: 'clara' }), next)).resolves.toMatchObject({
      kind: 'ask', reason: 'delete authored world character “clara”', displayReason: { en: 'Delete character “clara” in the world files?' },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('asks before part of an element is changed, showing the fields', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('update_world_element', undefined, { kind: 'character', key: 'clara', changes: { summary: 'New.' } }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'edit authored world character “clara”' })
    expect(next).not.toHaveBeenCalled()
  })

  it('asks before a trigger is written or removed', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('write_world_trigger', undefined, { key: 'knock', document: {} }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'write authored world trigger “knock”', displayReason: { en: 'Write trigger “knock” in the world files?', zh: '写入世界文件中的trigger “knock”？' } })
    await expect(authoringApproval(exec('delete_world_trigger', undefined, { key: 'knock' }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'delete authored world trigger “knock”' })
    expect(next).not.toHaveBeenCalled()
  })

  it('does not intercept reads or calls outside authoring chats', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('list_characters'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('delete_world_element', 'ordinary-chat'), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('lets the turn that has just imported a card correct the world without asking', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('replace_world_element', undefined, { kind: 'location', key: 'dock' }), next, () => Promise.resolve(true))).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('what a write tells about the rest of the world', () => {
  it('reports the problems the world still has next to the result, and an ok when none', async () => {
    vi.resetModules()
    const checks = [{ ok: false, problems: [{ where: 'characters/a', message: 'unknown place' }], more: 3 }, { ok: true, problems: [], more: 0 }]
    vi.doMock('../../../src/host/worlds/world-check.ts', () => ({ checkWorld: async () => checks.shift() }))
    const { withWorldCheck } = await import('../../../src/host/authoring/write-tools.ts')
    const reader = { read: async () => ({ record: { directory: '/w', summary: {} } }) } as never
    const tool = withWorldCheck(reader, { name: 'x', execute: async () => ({ action: 'created' }) } as never) as unknown as { execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }
    const first = await tool.execute({}, {})
    expect(first['action']).toBe('created')
    expect(first['check_world']).toMatchObject({ ok: false, still_open: ['characters/a: unknown place'], more: 3 })
    expect((await tool.execute({}, {}))['check_world']).toMatch(/^ok/)
    vi.doUnmock('../../../src/host/worlds/world-check.ts')
  })
})

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 4)}\n`) }
const stored = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown
const reader = () => ({ read: async () => ({ record: { summary: { id: 'harbor' }, directory } }) }) as never
const call = async (name: string, args: Record<string, unknown>) => {
  const found = authoredWorldWriteTools(reader()).find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`there is no tool ${name}`)
  return await (found.execute as unknown as (given: Record<string, unknown>, execution: unknown) => Promise<Record<string, unknown>>)(args, exec(name))
}

describe('changing one part of a world through the tools', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'authoring-write-tools-'))
    await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor' })
    await write(join(directory, 'locations', 'bar', 'location.json'), { name: 'The Bar', exits: [{ to: 'cellar', description: 'stairs' }] })
    await write(join(directory, 'locations', 'cellar', 'location.json'), { name: 'The Cellar' })
    await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'npc', summary: 'Innkeeper.', start: { location: 'bar' } })
    await write(join(directory, 'plots.json'), [{ id: 'heist', name: 'The Heist', premise: 'One last job.', participants: [], hooks: [{ id: 'h', text: 'A hook.', mode: 'opportunity' }], developments: [], resolutions: ['It ends.'] }])
    await write(join(directory, 'triggers.json'), [{ key: 'knock', name: 'Knock', when: { type: 'place', character: 'clara', location: 'bar' }, effects: [{ type: 'beat', text: 'Someone knocks.' }] }])
    await write(join(directory, 'variables.json'), [{ key: 'tiredness', name: 'Tiredness', kind: 'number', subject: 'character', visibility: 'public', update: 'rises when the character works', default: 0 }])
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('changes the fields of one element and says what it did', async () => {
    const done = await call('update_world_element', { kind: 'character', key: 'clara', changes: { summary: 'Keeper of the bar.' } })
    expect(done).toMatchObject({ action: 'updated', kind: 'character', key: 'clara', counts: { characters: 1, locations: 2, plots: 1 } })
    expect(await stored(join(directory, 'characters', 'clara', 'character.json'))).toMatchObject({ name: 'Clara', summary: 'Keeper of the bar.', start: { location: 'bar' } })
  })

  it('changes the fields of one plot and leaves the rest of it', async () => {
    const done = await call('update_world_plot', { key: 'heist', changes: { premise: 'Changed.' } })
    expect(done).toMatchObject({ action: 'updated', kind: 'plot', key: 'heist' })
    expect(await stored(join(directory, 'plots.json'))).toMatchObject([{ id: 'heist', premise: 'Changed.', hooks: [{ id: 'h' }] }])
  })

  it('changes the fields of one trigger and check it as a story start would', async () => {
    const done = await call('update_world_trigger', { key: 'knock', changes: { name: 'A Knocking' } })
    expect(done).toMatchObject({ action: 'updated', kind: 'trigger', key: 'knock' })
    expect(await stored(join(directory, 'triggers.json'))).toMatchObject([{ key: 'knock', name: 'A Knocking', effects: [{ type: 'beat', text: 'Someone knocks.' }] }])
    await expect(call('update_world_trigger', { key: 'knock', changes: { when: { type: 'place', character: 'clara', location: 'moon' } } })).rejects.toThrow('there is no place "moon"')
  })

  it('changes one entry of a whole-world file and leaves the other entries', async () => {
    const done = await call('update_world_file', { kind: 'variables', key: 'tiredness', changes: { name: 'Fatigue' } })
    expect(done).toMatchObject({ action: 'updated', kind: 'variables', key: 'tiredness' })
    expect(await stored(join(directory, 'variables.json'))).toMatchObject([{ key: 'tiredness', name: 'Fatigue', update: 'rises when the character works' }])
    await expect(call('update_world_file', { kind: 'variables', key: 'hunger', changes: { name: 'X' } })).rejects.toThrow('the keys are: tiredness')
    await expect(call('update_world_file', { kind: 'nonsense', key: 'x', changes: {} })).rejects.toThrow('"kind" must be one of ["variables","dice","commands","calendar"]')
  })
})
