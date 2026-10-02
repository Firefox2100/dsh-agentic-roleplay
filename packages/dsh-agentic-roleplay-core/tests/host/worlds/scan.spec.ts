import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanWorlds } from '../../../src/host/worlds/scan.ts'

let dir: string

async function world(folder: string, content: unknown = { id: folder, name: folder }): Promise<string> {
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

  it('reads one world per direct subfolder, identified by the id in its file', async () => {
    await world('b world', { id: 'second', name: 'B' })
    await world('日本語世界', { id: 'first', name: '世界' })
    const { worlds, problems } = await scanWorlds(dir)
    expect(problems).toEqual([])
    expect(worlds.map(record => [record.summary.id, record.folder, record.directory]).sort()).toEqual([
      ['first', '日本語世界', join(dir, '日本語世界')],
      ['second', 'b world', join(dir, 'b world')],
    ])
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
    await world('w', { id: 'w', name: 'W', description: 'D', author: { name: 'Me' }, metadata: { tags: ['a', 'b'] }, cover_media_id: null })
    const { worlds, problems } = await scanWorlds(dir)
    expect(problems).toEqual([])
    expect(worlds[0]?.summary).toEqual({ id: 'w', name: 'W', description: 'D', tags: ['a', 'b'], author: { name: 'Me' } })
    expect(worlds[0]?.cover).toBeUndefined()
  })

  describe('world id', () => {
    const read = async (folder: string): Promise<Record<string, unknown>> =>
      JSON.parse(await readFile(join(dir, folder, 'world.json'), 'utf8')) as Record<string, unknown>

    it('is written into a file that has none, keeping the rest of it', async () => {
      await world('w', { name: 'W', description: 'D', metadata: { tags: ['a'] } })
      const { worlds, problems } = await scanWorlds(dir)
      expect(problems).toEqual([])
      const id = worlds[0]?.summary.id ?? ''
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(await read('w')).toEqual({ id, name: 'W', description: 'D', metadata: { tags: ['a'] } })
      expect(Object.keys(await read('w'))[0]).toBe('id')
    })

    it('stays the same on every later scan', async () => {
      await world('w', { name: 'W' })
      const first = (await scanWorlds(dir)).worlds[0]?.summary.id
      const second = (await scanWorlds(dir)).worlds[0]?.summary.id
      expect(second).toBe(first)
    })

    it('is kept when the file already has one', async () => {
      await world('w', { id: 'my-own-id', name: 'W' })
      const before = await readFile(join(dir, 'w', 'world.json'), 'utf8')
      expect((await scanWorlds(dir)).worlds[0]?.summary.id).toBe('my-own-id')
      expect(await readFile(join(dir, 'w', 'world.json'), 'utf8')).toBe(before)
    })

    it('does not change a file that is invalid', async () => {
      await world('w', '{ "name": ')
      await scanWorlds(dir)
      expect(await readFile(join(dir, 'w', 'world.json'), 'utf8')).toBe('{ "name": ')
    })

    it('leaves nothing but the world file behind', async () => {
      await world('w', { name: 'W' })
      await scanWorlds(dir)
      expect(await readdir(join(dir, 'w'))).toEqual(['world.json'])
    })

    it('is reported as a problem, and the world skipped, when two worlds share one', async () => {
      await world('a', { id: 'same', name: 'A' })
      await world('b', { id: 'same', name: 'B' })
      const { worlds, problems } = await scanWorlds(dir)
      expect(worlds.map(record => record.summary.name)).toEqual(['A'])
      expect(problems).toEqual([{ path: join(dir, 'b', 'world.json'), message: 'id "same" is already used by a' }])
    })

    it.skipIf(process.getuid?.() === 0)('makes a world unlisted, with the reason, when the file cannot be updated', async () => {
      const folder = await world('w', { name: 'W' })
      await chmod(folder, 0o555)
      try {
        const { worlds, problems } = await scanWorlds(dir)
        expect(worlds).toEqual([])
        expect(problems[0]?.message).toContain('has no id and one could not be added')
      } finally {
        await chmod(folder, 0o755)
      }
    })
  })

  describe('cover', () => {
    it('is the file the media manifest names for the cover id', async () => {
      const folder = await world('w', { id: 'w', name: 'W', cover_media_id: 'm1' })
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
      const folder = await world('w', { id: 'w', name: 'W', cover_media_id: 'm1' })
      if (rows !== undefined) await media(folder, rows)
      const { worlds, problems } = await scanWorlds(dir)
      expect(worlds).toHaveLength(1)
      expect(worlds[0]?.cover).toBeUndefined()
      expect(worlds[0]?.summary.coverVersion).toBeUndefined()
      expect(problems[0]?.message).toContain(message)
    })

    it('rejects a link that leaves the world folder', async () => {
      const folder = await world('w', { id: 'w', name: 'W', cover_media_id: 'm1' })
      await media(folder, [{ id: 'm1', file: 'media/files/m1.png' }])
      await writeFile(join(dir, 'secret.png'), 'x')
      await symlink(join(dir, 'secret.png'), join(folder, 'media', 'files', 'm1.png'))
      const { worlds, problems } = await scanWorlds(dir)
      expect(worlds[0]?.cover).toBeUndefined()
      expect(problems[0]?.message).toContain('inside the world folder')
    })
  })
})
