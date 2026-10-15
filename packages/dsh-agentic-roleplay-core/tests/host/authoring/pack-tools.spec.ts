import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PACK_GUIDE, worldPackTools } from '../../../src/host/authoring/pack-tools.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'world-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const tools = () => {
  const reader = { read: () => Promise.resolve({ record: { directory } }) } as never
  const all = new Map(worldPackTools(reader).map(tool => [tool.name, tool]))
  return (name: string, args: Record<string, unknown> = {}) => (all.get(name) as unknown as { execute(args: unknown, exec: unknown): Promise<unknown> | unknown }).execute(args, { agent: { session: { id: 'x', header: { cwd: dirname(directory) } } } })
}
const exec = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: authoringChatSessionId('harbor') } } }) as never

const manifest = JSON.stringify({ name: 'Atlas', actions: ['say'], surfaces: { hud: { file: 'hud.html' } } })

describe('the pack tools of world authoring', () => {
  const write = async (path: string, text: string) => { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), text) }

  it('give the guide with the folder, the limits and the hooks', async () => {
    const result = await tools()('world_pack_guide') as { folder: string; guide: string }
    expect(result.guide).toBe(PACK_GUIDE)
    expect(result.folder).toBe(join(directory, 'ui'))
    expect((result as unknown as { relative: string }).relative).toBe(join(basename(directory), 'ui'))
    expect(result.guide).toContain('data-rp')
    expect(result.guide).toContain('rp.watch')
    expect(result.guide).toContain('sidebar a page')
    expect(result.guide).toContain("rp.open('tab' | 'sidebar')")
    expect(result.guide).toContain('200 files')
    expect(result.guide).toContain('write, edit and read')
    expect(result.guide).toContain('a promise of the player view')
  })

  it('list the packs with where their files go, their files, and what is wrong with each', async () => {
    const call = tools()
    await write('ui/atlas/pack.json', manifest)
    await write('ui/atlas/hud.html', '<p>hi</p>')
    await write('ui/broken/pack.json', '{ "api": 3 }')
    const listed = await call('list_world_packs') as { id: string; path: string; files: string[]; problems: { message: string }[] }[]
    expect(listed.map(entry => [entry.id, entry.path])).toEqual([['atlas', join(basename(directory), 'ui', 'atlas')], ['broken', join(basename(directory), 'ui', 'broken')]])
    expect(listed[0]?.files).toEqual(['hud.html', 'pack.json'])
    expect(listed[0]?.problems).toEqual([])
    expect(listed[1]?.problems[0]?.message).toContain('api 1')
  })

  it('check a pack as session start will, and refuse a name that is not one', async () => {
    const call = tools()
    await write('ui/atlas/pack.json', manifest)
    expect(await call('check_world_pack', { pack: 'atlas' })).toMatchObject({ problems: [expect.objectContaining({ message: expect.stringContaining('has no file "hud.html"') })] })
    await write('ui/atlas/hud.html', '<p>hi</p>')
    expect(await call('check_world_pack', { pack: 'atlas' })).toEqual({ pack: 'atlas', problems: [] })
    await expect(call('check_world_pack', { pack: '../x' })).rejects.toThrow('not a usable pack name')
    await expect(call('check_world_pack', { pack: 'none' })).rejects.toThrow('carries no pack')
  })

  it('move a deleted file into the trash and keep the rest of the pack', async () => {
    const call = tools()
    await write('ui/atlas/pack.json', manifest)
    await write('ui/atlas/hud.html', '<p>hi</p>')
    const result = await call('delete_world_pack_file', { pack: 'atlas', path: 'hud.html' }) as { trashPath: string; problems: unknown[] }
    expect(await readFile(result.trashPath, 'utf8')).toBe('<p>hi</p>')
    expect(existsSync(join(directory, 'ui', 'atlas', 'hud.html'))).toBe(false)
    expect(existsSync(join(directory, 'ui', 'atlas', 'pack.json'))).toBe(true)
    expect(result.problems).not.toEqual([])
    await expect(call('delete_world_pack_file', { pack: 'atlas', path: '../pack.json' })).rejects.toThrow('not a file of a pack')
    await expect(call('delete_world_pack_file', { pack: 'atlas', path: 'none.html' })).rejects.toThrow('has no file')
  })

  it('no longer offer a write or a read of their own: DSH\'s file tools do that', () => {
    const names = worldPackTools({ read: () => Promise.resolve({ record: { directory } }) } as never).map(tool => tool.name)
    expect(names).toEqual(['world_pack_guide', 'list_world_packs', 'check_world_pack', 'delete_world_pack_file'])
  })
})

describe('approval of pack changes', () => {
  it('asks before a file is deleted', async () => {
    expect(await authoringApproval(exec('delete_world_pack_file', { pack: 'atlas', path: 'hud.html' }), () => Promise.resolve({ kind: 'allow' } as never))).toMatchObject({ kind: 'ask' })
    expect(await authoringApproval(exec('check_world_pack', { pack: 'atlas' }), () => Promise.resolve({ kind: 'allow' } as never))).toEqual({ kind: 'allow' })
  })

  it('is refused to an import that is reviewing the world', async () => {
    const decision = await authoringApproval(exec('delete_world_pack_file', { pack: 'atlas', path: 'hud.html' }), () => Promise.resolve({ kind: 'allow' } as never), () => Promise.resolve(true))
    expect(decision).toMatchObject({ kind: 'deny' })
  })
})
