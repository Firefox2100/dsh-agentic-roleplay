import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteTriggerDocument, readTriggerDocuments, writeTriggerDocument } from '../../../src/host/triggers/files.ts'
import { loadWorldParts } from '../../../src/host/triggers/parts.ts'

let directory: string
const put = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const stored = async () => JSON.parse(await readFile(join(directory, 'triggers.json'), 'utf8')) as { key: string }[]
const write = async (key: string, document: unknown) => await writeTriggerDocument(directory, await loadWorldParts(directory), key, document)

const knock = { name: 'Knock', when: { type: 'place', character: 'clara', location: 'inn' }, effects: [{ type: 'beat', text: 'Someone knocks at {place:inn}.' }] }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'triggers-files-'))
  await put(join(directory, 'locations', 'inn', 'location.json'), { name: 'The Inn' })
  await put(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'npc', summary: 'Innkeeper.', start: { location: 'inn' } })
  await put(join(directory, 'items', 'key', 'item.json'), { name: 'Brass Key', location: 'inn' })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('writing a trigger of a world', () => {
  it('creates the file with the first, appends the next, and replaces one by its key, leaving the others as they were', async () => {
    expect(await readTriggerDocuments(directory)).toEqual([])
    await expect(write('knock', knock)).resolves.toBe('created')
    await expect(write('smoke', { ...knock, name: 'Smoke', when: { type: 'fired', trigger: 'knock' } })).resolves.toBe('created')
    await expect(write('knock', { ...knock, name: 'Knock, knock', repeat: true })).resolves.toBe('replaced')
    expect((await stored()).map(entry => entry.key)).toEqual(['knock', 'smoke'])
    expect(await stored()).toMatchObject([{ key: 'knock', name: 'Knock, knock', repeat: true }, { key: 'smoke', name: 'Smoke' }])
  })

  it('names every problem and writes nothing when it is malformed, has a field that is not one, or names what the world does not have', async () => {
    await expect(write('bad', { ...knock, when: { type: 'place', character: 'zed', location: 'moon' }, effects: [{ type: 'cue', characters: ['clara'], text: '{where:ghost}', while: { type: 'item', item: 'orb', held_by: '@self' } }] })).rejects.toMatchObject({
      problems: expect.arrayContaining(['when: there is no character "zed"', 'when: there is no place "moon"', 'effects[0].text: {where:ghost}: there is no character "ghost"', 'effects[0].while: there is no item "orb"']),
    })
    await expect(write('typo', { ...knock, repeats: true })).rejects.toMatchObject({ problems: [expect.stringContaining('"repeats" is not a field of a trigger')] })
    await expect(write('empty', { name: 'x' })).rejects.toMatchObject({ problems: expect.arrayContaining([expect.stringContaining('effects')]) })
    await expect(write('later', { ...knock, when: { type: 'fired', trigger: 'never-made' } })).rejects.toMatchObject({ problems: [expect.stringContaining('there is no trigger "never-made"')] })
    await expect(readFile(join(directory, 'triggers.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is refused while the world has problems of its own, which come first', async () => {
    await put(join(directory, 'items', 'bad', 'item.json'), { name: 'Bad', location: 'nowhere' })
    await expect(loadWorldParts(directory)).rejects.toMatchObject({ problems: [expect.stringContaining('other files have problems')] })
  })

  it('reads what the file is not: not JSON, not a list', async () => {
    await writeFile(join(directory, 'triggers.json'), '{')
    await expect(readTriggerDocuments(directory)).rejects.toMatchObject({ problems: [expect.stringContaining('not valid JSON')] })
    await writeFile(join(directory, 'triggers.json'), '{}')
    await expect(readTriggerDocuments(directory)).rejects.toMatchObject({ problems: ['triggers.json is not a list of triggers'] })
  })
})

describe('removing a trigger of a world', () => {
  it('keeps its document in the trash, and does not remove one that others wait for', async () => {
    await write('knock', knock)
    await write('smoke', { ...knock, name: 'Smoke', when: { type: 'all', conditions: [{ type: 'fired', trigger: 'knock' }, { type: 'event', tag: 'x' }] } })
    await expect(deleteTriggerDocument(directory, 'knock')).rejects.toMatchObject({ problems: ['smoke waits for "knock" to fire; change it first'] })
    const kept = await deleteTriggerDocument(directory, 'smoke')
    expect(JSON.parse(await readFile(kept, 'utf8'))).toMatchObject({ key: 'smoke' })
    expect(await readdir(join(directory, '.trash', 'triggers'))).toHaveLength(1)
    await deleteTriggerDocument(directory, 'knock')
    expect(await stored()).toEqual([])
    await expect(deleteTriggerDocument(directory, 'knock')).rejects.toMatchObject({ problems: ['there is no trigger "knock"'] })
  })
})
