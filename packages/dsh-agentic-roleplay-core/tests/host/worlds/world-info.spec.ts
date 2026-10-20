import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWorldInfoEdit } from '../../../src/shared/world-info.ts'
import { editWorldInfo, readWorldInfo } from '../../../src/host/worlds/world-info.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function world(document: object): Promise<string> {
  const directory = join(tmpdir(), `world-info-${process.pid}-${Date.now()}-${Math.random()}`)
  roots.push(directory)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'world.json'), `${JSON.stringify(document, null, 4)}\n`)
  return directory
}

describe('the world\'s own fields', () => {
  it('carry the preset the world suggests, set and cleared like any text field, and refuse a name that is no preset', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour' })
    expect(await readWorldInfo(directory)).toMatchObject({ preset: '' })
    expect(await editWorldInfo(directory, { preset: 'noir' })).toMatchObject({ preset: 'noir' })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).toMatchObject({ preset: 'noir' })
    await expect(editWorldInfo(directory, { preset: 'not a name!' })).rejects.toThrow(/preset/)
    expect(await editWorldInfo(directory, { preset: '' })).toMatchObject({ preset: '' })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).not.toHaveProperty('preset')
  })

  it('carry the tools the world\'s agents have switched, with names this version does not know kept', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', tools: { gameMaster: { roll_dice: false, future_tool: true } } })
    expect(await readWorldInfo(directory)).toMatchObject({ tools: { gameMaster: { roll_dice: false, future_tool: true } } })
    expect(await editWorldInfo(directory, { tools: { gameMaster: { roll_check: false } } })).toMatchObject({ tools: { gameMaster: { roll_check: false } } })
    expect(await editWorldInfo(directory, { tools: {} })).toMatchObject({ tools: {} })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).not.toHaveProperty('tools')
    expect(() => parseWorldInfoEdit({ tools: { gameMaster: { roll_dice: 1 } } })).toThrow(/true or false/)
    expect(parseWorldInfoEdit({ tools: { gameMaster: { roll_dice: false } } })).toEqual({ tools: { gameMaster: { roll_dice: false } } })
  })

  it('are read, and changed without touching anything else in the file', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', description: 'Old.', metadata: { tags: ['a'], extra: 1 }, cover_media_id: 'cover', opening_message: 'It begins.', unknown: { keep: true } })
    expect(await readWorldInfo(directory)).toMatchObject({ name: 'Harbour', tags: ['a'], opening: 'It begins.', openingParts: false, rules: [] })
    const info = await editWorldInfo(directory, { description: 'New.', tags: ['b', 'c'], rules: ['There is no magic.'], authorName: 'Someone', authorUrl: 'https://example.test', timeZone: 'Europe/London', startingTime: '1912-04-14T23:40:00', opening: '' })
    expect(info).toMatchObject({ description: 'New.', tags: ['b', 'c'], rules: ['There is no magic.'], authorName: 'Someone', opening: '' })
    const written = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')) as Record<string, unknown>
    expect(written).toMatchObject({ id: 'w1', cover_media_id: 'cover', unknown: { keep: true }, metadata: { tags: ['b', 'c'], extra: 1 }, author: { name: 'Someone', url: 'https://example.test' }, time_zone: 'Europe/London' })
    expect(written).not.toHaveProperty('opening_message')
    expect(await readFile(join(directory, 'world.json'), 'utf8')).toContain('\n    "name"')
  })

  it('are refused when the world would no longer be readable, and nothing is written', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour' })
    const before = await readFile(join(directory, 'world.json'), 'utf8')
    await expect(editWorldInfo(directory, { timeZone: 'Nowhere/Land' })).rejects.toThrow(/time zone/)
    await expect(editWorldInfo(directory, { rules: Array.from({ length: 31 }, (_, n) => `rule ${n}`) })).rejects.toThrow(/more than 30 rules/)
    expect(await readFile(join(directory, 'world.json'), 'utf8')).toBe(before)
  })

  it('carry the author\'s version label, which can be changed and cleared', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', version: '1.0' })
    expect(await readWorldInfo(directory)).toMatchObject({ version: '1.0' })
    expect(await editWorldInfo(directory, { version: '1.1' })).toMatchObject({ version: '1.1' })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).toMatchObject({ version: '1.1' })
    expect(await editWorldInfo(directory, { version: '' })).toMatchObject({ version: '' })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).not.toHaveProperty('version')
    expect(() => parseWorldInfoEdit({ version: 'x'.repeat(41) })).toThrow(/version is longer than 40/)
    await expect(editWorldInfo(await world({ id: 'w2', name: 'Bay', version: 'y'.repeat(41) }), { description: 'x' })).rejects.toThrow(/version/)
  })

  it('keep an opening that has lines spoken by characters', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', opening_message: [{ type: 'narration', text: 'Fog.' }, { type: 'utterance', character: 'mira', text: 'Hello.' }] })
    expect((await readWorldInfo(directory)).openingParts).toBe(true)
    await expect(editWorldInfo(directory, { opening: 'Replaced.' })).rejects.toThrow(/lines spoken/)
    expect(await editWorldInfo(directory, { description: 'Fine.' })).toMatchObject({ description: 'Fine.', openingParts: true })
  })

  it('offer other openings that are read, replaced, and removed again', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', alternate_openings: [{ title: 'Dawn', text: 'Gulls cry.' }], unknown: 1 })
    expect((await readWorldInfo(directory)).alternateOpenings).toEqual([{ title: 'Dawn', text: 'Gulls cry.' }])
    const info = await editWorldInfo(directory, { alternateOpenings: [{ title: '', text: 'A bell rings over the quay.' }, { title: 'Night', text: 'Lamps gutter.' }] })
    expect(info.alternateOpenings.map(entry => entry.title)).toEqual(['A bell rings over the quay.', 'Night'])
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).toMatchObject({ unknown: 1, alternate_openings: [{ title: 'A bell rings over the quay.', text: 'A bell rings over the quay.' }, { title: 'Night', text: 'Lamps gutter.' }] })
    await editWorldInfo(directory, { alternateOpenings: [] })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).not.toHaveProperty('alternate_openings')
  })

  it('can be for one character, read, kept through an edit, and cleared by leaving the character out', async () => {
    const directory = await world({ id: 'w1', name: 'Harbour', alternate_openings: [{ title: 'Dawn', text: 'Gulls cry.', character: 'mira' }] })
    expect((await readWorldInfo(directory)).alternateOpenings).toEqual([{ title: 'Dawn', text: 'Gulls cry.', character: 'mira' }])
    expect(parseWorldInfoEdit({ alternateOpenings: [{ title: 'T', text: 'x', character: ' mira ' }, { text: 'y', character: ' ' }] })).toEqual({ alternateOpenings: [{ title: 'T', text: 'x', character: 'mira' }, { title: '', text: 'y' }] })
    await editWorldInfo(directory, { alternateOpenings: [{ title: 'Dawn', text: 'Gulls cry.' }] })
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')).alternate_openings).toEqual([{ title: 'Dawn', text: 'Gulls cry.' }])
  })

  it('come from the browser checked', () => {
    expect(parseWorldInfoEdit({ alternateOpenings: [{ title: ' T ', text: ' x ' }, { text: '  ' }] })).toEqual({ alternateOpenings: [{ title: 'T', text: 'x' }] })
    expect(() => parseWorldInfoEdit({ alternateOpenings: [{ title: 1, text: 'x' }] })).toThrow(/list of/)
    expect(() => parseWorldInfoEdit({ alternateOpenings: [{ text: 'x'.repeat(20_001) }] })).toThrow(/longer than/)
    expect(parseWorldInfoEdit({ name: ' X ', tags: [' a ', ''] })).toEqual({ name: 'X', tags: ['a'] })
    expect(() => parseWorldInfoEdit({ name: '', nope: 1, rules: 'x' })).toThrow(/needs a name/)
  })
})
