import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { worldCharacters } from '../../../src/host/sessions/world-characters.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let root: string
let worlds: WorldCatalog

async function write(path: string, content: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'world-characters-'))
  worlds = new WorldCatalog(new Context(), { path: root } as RoleplayRoot)
  await write(join(root, 'worlds', 'w', 'world.json'), { id: 'w', name: 'W' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('worldCharacters', () => {
  it('lists the cast with what the start dialog shows, and nothing private', async () => {
    const characters = join(root, 'worlds', 'w', 'characters')
    await write(join(characters, 'a', 'character.json'), {
      id: 'arthur', name: 'Arthur Moore', summary: 'Investigator.', role: 'playable',
      personality: 'Secret.', start: { inner_state: 'Distrustful.' },
    })
    await write(join(characters, 'b', 'character.json'), { name: 'Clara', tier: 'supporting' })
    const { characters: cast, problems } = await worldCharacters(worlds, 'w')
    expect(problems).toEqual([])
    expect(cast).toEqual([
      { id: 'arthur', name: 'Arthur Moore', summary: 'Investigator.', role: 'playable', tier: 'principal', kind: 'person' },
      { id: 'b', name: 'Clara', summary: '', role: 'npc', tier: 'supporting', kind: 'person' },
    ])
  })

  it('reports characters that cannot be read', async () => {
    await write(join(root, 'worlds', 'w', 'characters', 'bad', 'character.json'), '{')
    const { characters, problems } = await worldCharacters(worlds, 'w')
    expect(characters).toEqual([])
    expect(problems).toHaveLength(1)
  })

  it('has no characters for a world without a cast', async () => {
    expect(await worldCharacters(worlds, 'w')).toEqual({ characters: [], problems: [] })
  })

  it('fails for an unknown world', async () => {
    await expect(worldCharacters(worlds, 'nope')).rejects.toBeInstanceOf(WorldNotFoundError)
  })
})
