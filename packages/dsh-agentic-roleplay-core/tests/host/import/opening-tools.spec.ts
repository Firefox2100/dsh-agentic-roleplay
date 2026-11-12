import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { openingTools } from '../../../src/host/import/opening-tools.ts'

let directory: string
const list = vi.fn(() => Promise.resolve([]))
const worlds = { find: (id: string) => Promise.resolve(id === 'w1' ? { summary: { id: 'w1', name: 'W' }, directory } : undefined), list } as never
const settings = () => ({}) as never
const prompting = { prompts: () => ({ text: () => '' }), languages: () => ({ get: () => 'en' }) } as never
const exec = { agent: { session: { id: authoringChatSessionId('w1') } }, signal: new AbortController().signal } as never
const run = (target: string, form: string) => openingTools(worlds, settings, prompting)[0]!.execute({ target, form } as never, exec) as Promise<Record<string, unknown>>
const world = async (document: Record<string, unknown>) => { await writeFile(join(directory, 'world.json'), JSON.stringify({ id: 'w1', name: 'W', ...document })) }
const file = async () => JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')) as Record<string, unknown>

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'opening-tools-')); await mkdir(join(directory, 'characters'), { recursive: true }) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('reshape_opening', () => {
  it('joins parts that are only narration into plain text, for the opening and for an alternate', async () => {
    await world({ opening_message: [{ type: 'narration', text: 'Fog.' }, { type: 'narration', text: 'A bell.' }], alternate_openings: [{ title: 'Dawn', parts: [{ type: 'narration', text: 'Gulls.' }] }] })
    expect(await run('opening', 'plain')).toMatchObject({ changed: true })
    expect(await run('alternate:0', 'plain')).toMatchObject({ changed: true })
    const document = await file()
    expect(document['opening_message']).toBe('Fog.\n\nA bell.')
    expect(document['alternate_openings']).toEqual([{ title: 'Dawn', text: 'Gulls.' }])
  })

  it('refuses plain text when a character speaks, and says when nothing changes', async () => {
    await world({ opening_message: [{ type: 'utterance', character: 'mira', text: 'Hello.' }], alternate_openings: [{ title: 'Dawn', text: 'Gulls.' }] })
    await expect(run('opening', 'plain')).rejects.toThrow(/characters speak/)
    expect(await run('opening', 'parts')).toMatchObject({ changed: false, note: expect.stringMatching(/already in parts/) })
    expect(await run('alternate:0', 'plain')).toMatchObject({ changed: false })
    expect((await file())['opening_message']).toEqual([{ type: 'utterance', character: 'mira', text: 'Hello.' }])
  })

  it('names what it cannot find', async () => {
    await world({ opening_message: 'Fog.' })
    await expect(run('alternate:3', 'plain')).rejects.toThrow(/no alternate opening 3/)
    await expect(run('elsewhere', 'plain')).rejects.toThrow(/target is/)
  })
})
