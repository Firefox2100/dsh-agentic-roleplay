import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startSession } from '../../../src/host/sessions/start-session.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { WorldFolderExistsError } from '../../../src/host/worlds/create-world.ts'
import { listWorldPacks } from '../../../src/host/interface/world-packs.ts'
import { UnknownStarterError, addStarterWorld, listStarterWorlds, starterDirectory } from '../../../src/host/worlds/starter.ts'

let root: string
let catalog: WorldCatalog

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'starter-'))
  catalog = new WorldCatalog(new Context(), { path: root } as RoleplayRoot)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the starter worlds', () => {
  it('ship with the package and are listed as not yet added', async () => {
    expect(await listStarterWorlds(catalog)).toMatchObject([{ folder: 'blackwater-observatory', name: 'The Blackwater Observatory', installed: false }])
  })

  it('are copied into the worlds as a world of their own, and then count as added', async () => {
    const added = await addStarterWorld(catalog, 'blackwater-observatory')
    expect(added).toMatchObject({ name: 'The Blackwater Observatory', version: '1.0', author: { name: 'Firefox2100' } })
    expect((await readdir(join(root, 'worlds', 'blackwater-observatory'))).sort()).toEqual(['characters', 'items', 'locations', 'triggers.json', 'ui', 'variables.json', 'world.json'])
    expect((await listStarterWorlds(catalog))[0]?.installed).toBe(true)
    expect((await catalog.list()).problems).toEqual([])
  })

  it('are never overwritten: a folder or a world with the same id that is already there is refused and left alone', async () => {
    await addStarterWorld(catalog, 'blackwater-observatory')
    const file = join(root, 'worlds', 'blackwater-observatory', 'world.json')
    await writeFile(file, (await readFile(file, 'utf8')).replace('"1.0"', '"mine"'))
    await expect(addStarterWorld(catalog, 'blackwater-observatory')).rejects.toBeInstanceOf(WorldFolderExistsError)
    expect(await readFile(file, 'utf8')).toContain('"mine"')

    await rm(join(root, 'worlds'), { recursive: true })
    await mkdir(join(root, 'worlds', 'my copy'), { recursive: true })
    await writeFile(join(root, 'worlds', 'my copy', 'world.json'), JSON.stringify({ id: '51e09bac-6c9e-4ffd-a285-82fbc9c4399c', name: 'Mine' }))
    await expect(addStarterWorld(catalog, 'blackwater-observatory')).rejects.toThrow(/already have/)
    expect(await readdir(join(root, 'worlds'))).toEqual(['my copy'])
  })

  it('refuse a name the package does not ship', async () => {
    await expect(addStarterWorld(catalog, '../escape')).rejects.toBeInstanceOf(UnknownStarterError)
  })

  it('start a session: the world that ships is whole and its start has nothing unfinished', async () => {
    await addStarterWorld(catalog, 'blackwater-observatory')
    const state = new RoleplayState(new Context(), { journalMode: 'delete' })
    const ensured: (readonly { type: string; text: string }[] | undefined)[] = []
    const world = (await catalog.list()).worlds[0]!
    const started = await startSession({
      worlds: catalog, state,
      agent: { ensure: (id, _title, opening) => { ensured.push(opening); return Promise.resolve(`session-${id}`) }, retire: () => Promise.resolve() },
      sessionsDir: () => join(root, 'sessions'),
    }, { worldId: world.id, playerCharacterId: 'arthur-moore' })
    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.characters.list().length).toBeGreaterThanOrEqual(4)
    expect(session.metadata.get().world).toMatchObject({ version: '1.0' })
    expect(ensured[0]?.[0]?.text).toContain('Blackwater Ridge is loud tonight')
    expect(session.metadata.getValue('notes') ?? []).toEqual([])
  })

  it('are found from the source folder as from the build', () => {
    expect(starterDirectory()).toMatch(/starter-worlds$/)
  })
  it('ships an interface pack that can be used, with a strip and a tab', () => {
    const packs = listWorldPacks(join(starterDirectory(), 'blackwater-observatory'))
    expect(packs).toEqual([expect.objectContaining({ id: 'notebook', name: 'Field notebook', problems: [] })])
    expect(packs[0]?.files).toEqual(expect.arrayContaining(['pack.json', 'skin.css', 'strip.html', 'notebook.html']))
  })
})
