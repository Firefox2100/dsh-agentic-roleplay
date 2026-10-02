import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanWorlds } from '../../../src/host/worlds/scan.ts'

let dir: string

async function world(folder: string, content: unknown = { name: folder }): Promise<string> {
  const path = join(dir, folder)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'world.json'), typeof content === 'string' ? content : JSON.stringify(content))
  return path
}

async function media(worldDir: string, rows: unknown[], files: Record<string, string> = {}): Promise<void> {
  await mkdir(join(worldDir, 'media', 'files'), { recursive: true })
  await writeFile(join(worldDir, 'media', 'manifest.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  for (const [name, content] of Object.entries(files)) await writeFile(join(worldDir, 'media', 'files', name), content)
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'worlds-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('scanWorlds', () => {
  it('returns nothing for a missing directory', async () => {
    expect(await scanWorlds(join(dir, 'absent'))).toEqual({ worlds: [], problems: [] })
  })

  it('reads one world per direct subfolder, named by the folder', async () => {
    await world('b world')
    await world('日本語世界', { name: '世界' })
    const { worlds, problems } = await scanWorlds(dir)
    expect(problems).toEqual([])
    expect(worlds.map(record => record.summary.id).sort()).toEqual(['b world', '日本語世界'])
  })

  it('does not look below the first level', async () => {
    await world('group/inner', { name: 'Inner' })
    expect((await scanWorlds(dir)).worlds).toEqual([])
  })

  it('skips folders without a world.json, files and a world.json beside the folders', async () => {
    await mkdir(join(dir, 'notes'))
    await writeFile(join(dir, 'readme.md'), 'x')
    await writeFile(join(dir, 'world.json'), '{"name":"Top"}')
    const result = await scanWorlds(dir)
    expect(result).toEqual({ worlds: [], problems: [] })
  })

  it('sorts by name', async () => {
    await world('x', { name: 'beta' })
    await world('y', { name: 'Alpha' })
    await world('z', { name: 'gamma' })
    expect((await scanWorlds(dir)).worlds.map(record => record.summary.name)).toEqual(['Alpha', 'beta', 'gamma'])
  })

  it('reports an invalid world and keeps the rest', async () => {
    await world('good', { name: 'Good' })
    await world('bad', '{ nope')
    const { worlds, problems } = await scanWorlds(dir)
    expect(worlds).toHaveLength(1)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.path).toBe(join(dir, 'bad', 'world.json'))
    expect(problems[0]?.message).toContain('invalid JSON')
  })

  it('does not follow symbolic links to folders', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'))
    try {
      await writeFile(join(outside, 'world.json'), '{"name":"Linked"}')
      await symlink(outside, join(dir, 'link'))
      expect((await scanWorlds(dir)).worlds).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('lists a world with metadata tags and no cover without any problem', async () => {
    await world('w', { name: 'W', description: 'D', author: { name: 'Me' }, metadata: { tags: ['a', 'b'] }, cover_media_id: null })
    const { worlds, problems } = await scanWorlds(dir)
    expect(problems).toEqual([])
    expect(worlds[0]?.summary).toEqual({ id: 'w', name: 'W', description: 'D', tags: ['a', 'b'], author: { name: 'Me' } })
    expect(worlds[0]?.cover).toBeUndefined()
  })

  describe('cover', () => {
    it('is the file the media manifest names for the cover id', async () => {
      const folder = await world('w', { name: 'W', cover_media_id: 'm1' })
      await media(folder, [{ id: 'other', file: 'media/files/other.png' }, { id: 'm1', type: 'image/png', file: 'media/files/m1.png' }], { 'm1.png': 'png-bytes' })
      const [record] = (await scanWorlds(dir)).worlds
      expect(record?.cover?.contentType).toBe('image/png')
      expect(record?.cover?.size).toBe(9)
      expect(record?.summary.coverVersion).toBe(record?.cover?.version)
    })

    it.each([
      ['no media manifest', undefined, 'manifest.jsonl not found'],
      ['an id missing from the manifest', [{ id: 'other', file: 'media/files/o.png' }], 'is not in'],
      ['a row without a file', [{ id: 'm1' }], 'has no file'],
      ['a file that does not exist', [{ id: 'm1', file: 'media/files/gone.png' }], 'file not found'],
      ['an unsupported type', [{ id: 'm1', file: 'media/files/m1.svg' }], 'unsupported image type'],
      ['a path outside the folder', [{ id: 'm1', file: '../secret.png' }], 'inside the world folder'],
      ['an absolute path', [{ id: 'm1', file: '/etc/hostname.png' }], 'inside the world folder'],
    ])('keeps the world but reports %s', async (_label, rows, message) => {
      await writeFile(join(dir, 'secret.png'), 'x')
      const folder = await world('w', { name: 'W', cover_media_id: 'm1' })
      if (rows !== undefined) await media(folder, rows)
      const { worlds, problems } = await scanWorlds(dir)
      expect(worlds).toHaveLength(1)
      expect(worlds[0]?.cover).toBeUndefined()
      expect(worlds[0]?.summary.coverVersion).toBeUndefined()
      expect(problems[0]?.message).toContain(message)
    })

    it('rejects a link that leaves the world folder', async () => {
      const folder = await world('w', { name: 'W', cover_media_id: 'm1' })
      await media(folder, [{ id: 'm1', file: 'media/files/m1.png' }])
      await writeFile(join(dir, 'secret.png'), 'x')
      await symlink(join(dir, 'secret.png'), join(folder, 'media', 'files', 'm1.png'))
      const { worlds, problems } = await scanWorlds(dir)
      expect(worlds[0]?.cover).toBeUndefined()
      expect(problems[0]?.message).toContain('inside the world folder')
    })
  })
})
