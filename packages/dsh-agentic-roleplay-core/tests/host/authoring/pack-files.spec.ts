import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorldPack, readWorldPackFile, writeWorldPackFile } from '../../../src/host/authoring/pack-files.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'

let world: string
beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'pack-files-')) })
afterEach(async () => { await rm(world, { recursive: true, force: true }) })

describe('the files of a pack, edited by a person', () => {
  it('makes a pack with a manifest that names it, then adds a surface that the manifest can use', async () => {
    expect(await createWorldPack(world, 'atlas', 'Atlas')).toEqual([])
    expect(JSON.parse(await readFile(join(world, 'ui', 'atlas', 'pack.json'), 'utf8'))).toMatchObject({ name: 'Atlas', api: 1 })
    await expect(createWorldPack(world, 'atlas', 'Again')).rejects.toThrow('already carries a pack')
    await writeWorldPackFile(world, 'atlas', 'pack.json', JSON.stringify({ name: 'Atlas', api: 1, surfaces: { hud: { file: 'hud.html', height: 48 } } }))
    const problems = await writeWorldPackFile(world, 'atlas', 'pack.json', JSON.stringify({ name: 'Atlas', api: 1, surfaces: { hud: { file: 'hud.html', height: 48 } } }))
    expect(problems.map(problem => problem.message).join(' ')).toContain('has no file "hud.html"')
    expect(await writeWorldPackFile(world, 'atlas', 'hud.html', '<p>hello</p>')).toEqual([])
    expect(await readWorldPackFile(world, 'atlas', 'hud.html')).toBe('<p>hello</p>')
  })

  it('keeps a file that leaves the pack with problems, and refuses what is not a text file of a pack', async () => {
    await createWorldPack(world, 'atlas', 'Atlas')
    const problems = await writeWorldPackFile(world, 'atlas', 'pack.json', '{ not json')
    expect(problems.length).toBeGreaterThan(0)
    expect(await readFile(join(world, 'ui', 'atlas', 'pack.json'), 'utf8')).toBe('{ not json')
    await expect(writeWorldPackFile(world, 'atlas', 'map.png', 'x')).rejects.toThrow('not a text file of a pack')
    await expect(writeWorldPackFile(world, 'atlas', '../escape.html', 'x')).rejects.toBeInstanceOf(InvalidEditProblems)
    await expect(writeWorldPackFile(world, 'atlas', '.hidden.html', 'x')).rejects.toThrow('may not start with a dot')
    await expect(writeWorldPackFile(world, '../x', 'a.html', 'x')).rejects.toThrow('not a usable pack name')
    await expect(writeWorldPackFile(world, 'atlas', 'big.html', 'x'.repeat(201 * 1024))).rejects.toThrow('at most 200 KB')
    await expect(readWorldPackFile(world, 'atlas', 'gone.html')).rejects.toThrow('has no file "gone.html"')
    expect(existsSync(join(world, 'escape.html'))).toBe(false)
  })

  it('does not write through a symbolic link', async () => {
    await createWorldPack(world, 'atlas', 'Atlas')
    const outside = join(world, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'x.html'), 'kept')
    await symlink(outside, join(world, 'ui', 'atlas', 'link'))
    await expect(writeWorldPackFile(world, 'atlas', 'link/x.html', 'changed')).rejects.toThrow('symbolic link')
    expect(await readFile(join(outside, 'x.html'), 'utf8')).toBe('kept')
  })
})
