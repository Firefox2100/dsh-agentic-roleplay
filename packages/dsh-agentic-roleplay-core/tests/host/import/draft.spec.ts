import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { actOnDraft, draftStatus } from '../../../src/host/import/draft.ts'
import { importPhase } from '../../../src/host/import/run-import.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { isDraftWorld } from '../../../src/host/worlds/draft.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'

let root: string
let sent: string[]
let worlds: WorldCatalog
const world = () => join(root, 'worlds', 'draft')
const deps = () => ({ worlds, root: () => root, authoring: { ensure: (id: string) => Promise.resolve(`world-author-${id}`), send: (_chat: string, text: string) => { sent.push(text); return Promise.resolve() } } })
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)) }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'draft-'))
  sent = []
  await write(join(world(), 'world.json'), { id: 'w1', name: 'Draft' })
  await write(join(world(), 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', summary: 'x', start: { location: 'nowhere' } })
  await write(join(world(), '.import', 'state.json'), { phase: 'repair' })
  worlds = new WorldCatalog(new Context(), { path: root } as RoleplayRoot)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('a draft world', () => {
  it('is listed as a draft, and its status names what is wrong; mended, it is an ordinary world again', async () => {
    expect((await worlds.list()).worlds[0]).toMatchObject({ id: 'w1', draft: true })
    const status = await draftStatus(worlds, 'w1')
    expect(status.draft).toBe(true)
    expect(status.check?.problems.map(problem => problem.message).join('\n')).toMatch(/nowhere/)
    await write(join(world(), 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', summary: 'x' })
    expect(await draftStatus(worlds, 'w1')).toEqual({ draft: false })
    expect(await importPhase(world())).toBe('done')
    expect((await worlds.list()).worlds[0]).not.toHaveProperty('draft')
  })

  it('has the assistant try again, is kept as it is, or is discarded to the trash; only a draft can be decided about', async () => {
    const asked = await actOnDraft(deps(), 'w1', 'ask', 'zh')
    expect(asked.started).toMatchObject({ worldId: 'w1', started: true })
    expect(sent).toHaveLength(1)
    await actOnDraft(deps(), 'w1', 'keep')
    expect(await importPhase(world())).toBe('done')
    await expect(actOnDraft(deps(), 'w1', 'keep')).rejects.toBeInstanceOf(InvalidEditProblems)
    await write(join(world(), '.import', 'state.json'), { phase: 'repair' })
    const discarded = await actOnDraft(deps(), 'w1', 'discard')
    expect(discarded.keptIn).toMatch(/^\.trash[\\/]worlds[\\/]draft-\d+$/)
    expect(await readdir(join(root, 'worlds'))).toEqual([])
    expect((await worlds.list()).worlds).toEqual([])
  })

  it('reports a damaged import state instead of hiding the draft marker', async () => {
    await writeFile(join(world(), '.import', 'state.json'), '{')
    await expect(isDraftWorld(world())).rejects.toThrow(/JSON/)
  })
})
