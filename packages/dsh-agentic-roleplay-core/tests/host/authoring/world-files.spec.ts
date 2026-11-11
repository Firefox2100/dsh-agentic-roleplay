import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthoredWorldReader, authoredWorldReadTools } from '../../../src/host/authoring/read-tools.ts'
import { authoredWorldWriteTools, authoringApproval, validateMutation } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'world-files-'))
  await writeFile(join(directory, 'world.json'), `${JSON.stringify({ id: 'harbor', name: 'Harbor' })}\n`)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function reader() {
  const catalog = {
    find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary: { id: 'harbor', name: 'Harbor', description: '', tags: [] } } : undefined),
    list: vi.fn(() => Promise.resolve({ worlds: [], problems: [] })),
  } as unknown as WorldCatalog
  return new AuthoredWorldReader(catalog)
}
const chat = authoringChatSessionId('harbor')
const exec = (name = '', args: Record<string, unknown> = {}) => ({ name, arguments: args, agent: { session: { id: chat } }, signal: new AbortController().signal }) as never
const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const found = [...authoredWorldReadTools(reader()), ...authoredWorldWriteTools(reader())].find(tool => tool.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return await found.execute(args as never, exec(name, args))
}
const stored = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(directory, file), 'utf8'))

const variables = [{ key: 'mood_of_town', name: 'Mood of the town', kind: 'number', subject: 'world', visibility: 'public', min: 0, max: 10, default: 5, update: 'Changes when the town hears news.' }]
const dice = { checks: [{ key: 'nerve', name: 'Nerve', use: 'holding steady', dice: '2d6', bands: [{ label: 'holds', result: 'succeeded', min: 8 }, { label: 'breaks', result: 'failed', max: 7 }] }] }
const commands = { commands: [{ word: 'recruit', description: 'Ask the world for a new person.' }] }
const calendar = { hemisphere: 'north', holidays: [{ id: 'lantern', name: 'Lantern night', on: ['12-24'] }] }

describe('write_world_file and get_world_file', () => {
  it.each([['variables', 'variables.json', variables], ['dice', 'dice.json', dice], ['commands', 'commands.json', commands], ['calendar', 'calendar.json', calendar]] as const)('writes %s as the file a story start reads, and reads it back', async (kind, file, document) => {
    expect(await call('write_world_file', { kind, document })).toMatchObject({ action: 'written', kind })
    expect(await stored(file)).toEqual(document)
    expect(await call('get_world_file', { kind })).toEqual(document)
  })

  it('reads the empty form of a file the world does not have', async () => {
    expect(await call('get_world_file', { kind: 'variables' })).toEqual([])
    expect(await call('get_world_file', { kind: 'commands' })).toEqual({ commands: [] })
  })

  it('refuses a document a story start would refuse, with the reason, and writes nothing', async () => {
    await expect(call('write_world_file', { kind: 'commands', document: { commands: [{ word: 'wait', description: 'x' }] } })).rejects.toThrow(/used by the game itself/)
    await expect(call('write_world_file', { kind: 'variables', document: [{ key: 'a' }] })).rejects.toThrow()
    await expect(call('write_world_file', { kind: 'diary', document: [] })).rejects.toThrow(/kind/)
    expect(await readdir(directory)).toEqual(['world.json'])
  })

  it('refuses a tracked number that does not say when it changes, and names the field', async () => {
    const { update: _unsaid, ...bare } = variables[0]!
    const silent = [bare]
    await expect(call('write_world_file', { kind: 'variables', document: silent })).rejects.toThrow(/"update"/)
    await expect(call('write_world_file', { kind: 'variables', document: [{ key: 'seen', name: 'Seen', kind: 'flag', subject: 'world', visibility: 'public' }] })).resolves.toMatchObject({ action: 'written' })
  })

  it('removes the file for an empty document', async () => {
    await call('write_world_file', { kind: 'commands', document: commands })
    await call('write_world_file', { kind: 'commands', document: { commands: [] } })
    expect(await readdir(directory)).toEqual(['world.json'])
  })

  it('refuses what the rest of the world would not allow, as the editor does', async () => {
    await call('write_world_file', { kind: 'variables', document: [{ key: 'command_recruit', name: 'Recruit', kind: 'flag', subject: 'world', visibility: 'hidden' }] })
    await expect(call('write_world_file', { kind: 'commands', document: commands })).rejects.toThrow(/already declares/)
    await expect(call('write_world_file', { kind: 'dice', document: { checks: [{ ...dice.checks[0], modifier: 'nope' }] } })).rejects.toThrow(/does not declare/)
  })

  it('is asked of the person with its size, and a document it would refuse goes back without asking', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('write_world_file', { kind: 'dice', document: dice }), next, undefined, { validate: exec => validateMutation(reader(), exec) })).resolves.toMatchObject({ kind: 'ask', displayReason: { en: 'Write dice in the world files: 1 entries' } })
    await expect(authoringApproval(exec('write_world_file', { kind: 'commands', document: { commands: [{ word: 'ooc', description: 'x' }] } }), next, undefined, { validate: exec => validateMutation(reader(), exec) })).resolves.toMatchObject({ kind: 'deny' })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('start questions', () => {
  it('are a field of edit_world_info', async () => {
    const questions = [{ id: 'mood', text: 'How does the story begin?', options: [{ id: 'calm', label: 'Calm', effect: { opening: 'Quiet morning.' } }, { id: 'storm', label: 'Storm', effect: { opening: 'Thunder.' } }] }]
    await call('edit_world_info', { changes: { startQuestions: questions } })
    expect(await call('get_world_info')).toMatchObject({ startQuestions: [{ id: 'mood' }] })
  })
})
