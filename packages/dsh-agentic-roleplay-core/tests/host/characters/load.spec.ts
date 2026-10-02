import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadCharacters } from '../../../src/host/characters/load.ts'

let world: string

async function character(folder: string, content: unknown): Promise<void> {
  const dir = join(world, 'characters', folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'character.json'), typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'characters-')) })
afterEach(async () => { await rm(world, { recursive: true, force: true }) })

describe('loadCharacters', () => {
  it('has no characters when the world has no characters folder', async () => {
    expect(await loadCharacters(world)).toEqual({ characters: [], problems: [] })
  })

  it('reads one character per subfolder, in folder order, using the folder name as the default id', async () => {
    await character('b-second', { name: 'Second' })
    await character('a-first', { id: 'first', name: 'First', role: 'playable' })
    const { characters, problems } = await loadCharacters(world)
    expect(problems).toEqual([])
    expect(characters.map(item => [item.id, item.name, item.role])).toEqual([
      ['first', 'First', 'playable'],
      ['b-second', 'Second', 'npc'],
    ])
  })

  it('skips folders without a character.json, files and symbolic links', async () => {
    await mkdir(join(world, 'characters', 'empty'), { recursive: true })
    await writeFile(join(world, 'characters', 'notes.md'), 'x')
    const outside = await mkdtemp(join(tmpdir(), 'outside-'))
    try {
      await writeFile(join(outside, 'character.json'), '{"name":"Linked"}')
      await symlink(outside, join(world, 'characters', 'link'))
      expect(await loadCharacters(world)).toEqual({ characters: [], problems: [] })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('reports every problem of an invalid character and keeps the others', async () => {
    await character('good', { name: 'Good' })
    await character('bad', { age: -1 })
    const { characters, problems } = await loadCharacters(world)
    expect(characters.map(item => item.name)).toEqual(['Good'])
    expect(problems.map(problem => problem.message).sort()).toEqual([
      'age: must be a string or a non-negative number',
      'name: is required',
    ])
    expect(problems[0]?.path).toBe(join(world, 'characters', 'bad', 'character.json'))
  })

  it('keeps the first of two characters sharing an id and reports the second', async () => {
    await character('a', { id: 'same', name: 'A' })
    await character('b', { id: 'same', name: 'B' })
    const { characters, problems } = await loadCharacters(world)
    expect(characters.map(item => item.name)).toEqual(['A'])
    expect(problems).toEqual([{ path: join(world, 'characters', 'b', 'character.json'), message: 'id "same" is already used by a' }])
  })
})
