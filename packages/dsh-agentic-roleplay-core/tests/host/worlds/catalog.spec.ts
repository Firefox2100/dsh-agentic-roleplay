import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let base: string
const root = { path: '' }

async function addWorld(rootPath: string, id: string, name = id): Promise<void> {
  const folder = join(rootPath, 'worlds', id)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'world.json'), JSON.stringify({ name }))
}

function catalog(): WorldCatalog {
  return new WorldCatalog(new Context(), root as RoleplayRoot)
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'catalog-'))
  root.path = base
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('WorldCatalog', () => {
  it('serves the cached listing until a refresh is requested', async () => {
    await addWorld(base, 'one')
    const worlds = catalog()
    expect((await worlds.list()).worlds.map(world => world.id)).toEqual(['one'])

    await addWorld(base, 'two')
    expect((await worlds.list()).worlds.map(world => world.id)).toEqual(['one'])
    expect((await worlds.list({ refresh: true })).worlds.map(world => world.id)).toEqual(['one', 'two'])
    expect((await worlds.list()).worlds).toHaveLength(2)
  })

  it('scans again when the root moves', async () => {
    const other = await mkdtemp(join(tmpdir(), 'catalog-other-'))
    try {
      await addWorld(base, 'here')
      await addWorld(other, 'there')
      const worlds = catalog()
      expect((await worlds.list()).worlds[0]?.id).toBe('here')
      root.path = other
      const moved = await worlds.list()
      expect(moved.directory).toBe(join(other, 'worlds'))
      expect(moved.worlds[0]?.id).toBe('there')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('shares one scan between concurrent first reads', async () => {
    await addWorld(base, 'one')
    const worlds = catalog()
    const [a, b] = await Promise.all([worlds.list(), worlds.list()])
    expect(a.scannedAt).toBe(b.scannedAt)
  })

  it('makes a refresh issued during a scan see changes made after that scan began', async () => {
    await addWorld(base, 'one')
    const worlds = catalog()
    const first = worlds.list()
    await addWorld(base, 'two')
    const refreshed = await worlds.list({ refresh: true })
    await first
    expect(refreshed.worlds.map(world => world.id)).toEqual(['one', 'two'])
  })

  it('answers cover lookups only for known worlds with a cover', async () => {
    const folder = join(base, 'worlds', 'w')
    await mkdir(join(folder, 'media', 'files'), { recursive: true })
    await writeFile(join(folder, 'world.json'), JSON.stringify({ name: 'W', cover_media_id: 'm' }))
    await writeFile(join(folder, 'media', 'manifest.jsonl'), '{"id":"m","file":"media/files/m.png"}\n')
    await writeFile(join(folder, 'media', 'files', 'm.png'), 'x')
    await addWorld(base, 'plain')
    const worlds = catalog()
    expect((await worlds.cover('w'))?.contentType).toBe('image/png')
    expect(await worlds.cover('plain')).toBeUndefined()
    expect(await worlds.cover('../w')).toBeUndefined()
  })
})
