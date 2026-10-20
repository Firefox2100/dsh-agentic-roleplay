import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { createWorld, WorldFolderExistsError } from '../../../src/host/worlds/create-world.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'

let base: string
const root = { path: '' }

function catalog(): WorldCatalog {
  return new WorldCatalog(new Context(), root as RoleplayRoot)
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'create-world-'))
  root.path = base
})

afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('createWorld', () => {
  it('creates a minimal valid world and refreshes the catalog', async () => {
    const created = await createWorld(catalog(), { folder: 'a-new_world', name: 'A New World' })
    const document = JSON.parse(await readFile(join(base, 'worlds', 'a-new_world', 'world.json'), 'utf8')) as Record<string, unknown>

    expect(created).toMatchObject({ id: document.id, name: 'A New World' })
    expect(document).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'A New World', description: '', metadata: { tags: [] } })
  })

  it('records the preset it is given and refuses what is not a preset name', async () => {
    await createWorld(catalog(), { folder: 'styled', name: 'Styled', preset: 'noir' })
    expect(JSON.parse(await readFile(join(base, 'worlds', 'styled', 'world.json'), 'utf8'))).toMatchObject({ preset: 'noir' })
    await expect(createWorld(catalog(), { folder: 'other', name: 'Other', preset: '../x' })).rejects.toBeInstanceOf(InvalidEditProblems)
  })

  it.each(['../outside', 'nested/world', '.hidden', 'trailing.'])('rejects the unsafe folder name %s', async folder => {
    await expect(createWorld(catalog(), { folder, name: 'Unsafe' })).rejects.toBeInstanceOf(InvalidEditProblems)
  })

  it('does not alter a folder that already exists', async () => {
    const directory = join(base, 'worlds', 'existing')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'keep.txt'), 'mine')

    await expect(createWorld(catalog(), { folder: 'existing', name: 'Replacement' })).rejects.toBeInstanceOf(WorldFolderExistsError)
    await expect(readFile(join(directory, 'keep.txt'), 'utf8')).resolves.toBe('mine')
    await expect(access(join(directory, 'world.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
