import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SYNC } from '../../../src/shared/sync.ts'
import { UnitLockedError } from '../../../src/host/sync/errors.ts'
import { UnitGate } from '../../../src/host/sync/gate.ts'
import { SyncService } from '../../../src/host/sync/service.ts'
import { readStore } from '../../../src/host/sync/state.ts'

const hasRclone = spawnSync('rclone', ['version']).status === 0
const SESSION = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b'

interface Device {
  root: string
  gate: UnitGate
  service: SyncService
  released: string[]
  pulled: string[]
  removed: string[]
  busy: { reason?: string; chatFails?: boolean }
}

describe.skipIf(!hasRclone)('SyncService with rclone', () => {
  let base: string
  let remote: string
  let config: string
  let devices: Device[]

  async function device(name: string): Promise<Device> {
    const root = join(base, name)
    await mkdir(join(root, 'worlds'), { recursive: true })
    await mkdir(join(root, 'sessions'), { recursive: true })
    const gate = new UnitGate()
    const released: string[] = []
    const pulled: string[] = []
    const removed: string[] = []
    const busy: { reason?: string; chatFails?: boolean } = {}
    const service = new SyncService({
      root: () => root,
      config: () => ({ ...DEFAULT_SYNC, remote, configFile: config }),
      password: async () => undefined,
      gate,
      busy: () => busy.reason,
      idle: async () => undefined,
      release: async (session) => { released.push(session) },
      remove: async (session) => { removed.push(session); await rm(join(root, 'sessions', session), { recursive: true, force: true }) },
      pulled: async (session) => { pulled.push(session); if (busy.chatFails === true) throw new Error('the chat could not be made again') },
      changed: async () => undefined,
      problem: () => undefined,
    })
    const made = { root, gate, service, released, pulled, removed, busy }
    devices.push(made)
    return made
  }

  const write = async (root: string, path: string, text: string): Promise<void> => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const read = async (root: string, path: string): Promise<string> => await readFile(join(root, path), 'utf8')
  const unit = (status: Awaited<ReturnType<SyncService['status']>>, id: string) => status.units.find(entry => entry.id === id)

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'roleplay-sync-'))
    remote = join(base, 'remote')
    config = join(base, 'rclone.conf')
    await mkdir(remote)
    await writeFile(config, '')
    devices = []
  })
  afterEach(async () => { await rm(base, { recursive: true, force: true }) })

  it('refuses to run until the settings are usable, and keeps the configuration file out of the root', async () => {
    const a = await device('a')
    expect(new SyncService({ root: () => a.root, config: () => DEFAULT_SYNC } as never).problem()).toMatch(/no remote/)
    const inside = new SyncService({ root: () => a.root, config: () => ({ ...DEFAULT_SYNC, remote, configFile: join(a.root, 'rclone.conf') }) } as never)
    await writeFile(join(a.root, 'rclone.conf'), '')
    expect(inside.problem()).toMatch(/outside the roleplay root/)
    expect(a.service.problem()).toBeUndefined()
  })

  it('moves a session whole to another device and back, and tells a change on both sides', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await write(a.root, `${id}/timeline.json`, 't1')
    await a.service.run()
    expect(unit(await a.service.status(), id)?.state).toBe('synced')
    expect(a.released).toEqual([SESSION])

    await b.service.run()
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('one')
    expect(b.pulled).toEqual([SESSION])
    expect(b.released).toEqual([SESSION])

    await write(b.root, `${id}/session.sqlite`, 'two')
    expect(unit(await b.service.status(), id)?.state).toBe('changed')
    await b.service.run()
    await a.service.run()
    expect(await read(a.root, `${id}/session.sqlite`)).toBe('two')

    await write(a.root, `${id}/session.sqlite`, 'from a')
    await write(b.root, `${id}/session.sqlite`, 'from b')
    await a.service.run()
    const result = await b.service.run()
    expect(result.units.find(entry => entry.id === id)?.state).toBe('conflict')
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('from b')

    await b.service.resolve(id, 'remote')
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('from a')
    expect(unit(await b.service.status(), id)?.state).toBe('synced')
  })

  it('tries again to make the chat from a pulled session when it failed, without taking the pull for a change made here', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await a.service.run()
    b.busy.chatFails = true
    const first = await b.service.run()
    expect(first.units[0]?.state).toBe('failed')
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('one')
    b.busy.chatFails = false
    const second = await b.service.run()
    expect(second.units[0]?.state).toBe('synced')
    expect(b.pulled).toEqual([SESSION, SESSION])
  })

  it('does not bring back a session that was deleted here, and skips one that is busy', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    a.busy.reason = 'a turn is being played'
    const skipped = await a.service.run()
    expect(skipped.units[0]?.message).toMatch(/turn is being played/)
    delete a.busy.reason
    await a.service.run()

    b.service.forget(id)
    await b.service.run()
    expect((await readdir(join(b.root, 'sessions')))).toEqual([])
  })

  it('syncs the files of a world on their own and leaves two copies of a file both sides changed', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = 'worlds/harbor'
    await write(a.root, `${id}/world.json`, '{"name":"Harbor"}')
    await write(a.root, `${id}/lore/notes.md`, 'start')
    await a.service.run()
    await b.service.run()
    expect(await read(b.root, `${id}/lore/notes.md`)).toBe('start')

    await write(a.root, `${id}/lore/notes.md`, 'from a')
    await write(b.root, `${id}/world.json`, '{"name":"Harbour"}')
    await a.service.run()
    await b.service.run()
    await a.service.run()
    expect(await read(b.root, `${id}/lore/notes.md`)).toBe('from a')
    expect(await read(a.root, `${id}/world.json`)).toBe('{"name":"Harbour"}')

    await write(a.root, `${id}/lore/notes.md`, 'a again')
    await write(b.root, `${id}/lore/notes.md`, 'b has written more')
    await a.service.run()
    const result = await b.service.run()
    const entry = result.units.find(unit => unit.id === id)
    expect(entry?.state).toBe('conflict')
    expect(entry?.conflicts).toEqual(['lore/notes.md.conflict1', 'lore/notes.md.conflict2'])

    await b.service.resolve(id, 'local')
    expect(await read(b.root, `${id}/lore/notes.md`)).toBe('b has written more')
    expect(await readdir(join(b.root, id, 'lore'))).toEqual(['notes.md'])
    await a.service.run()
    expect(await read(a.root, `${id}/lore/notes.md`)).toBe('b has written more')
    expect(unit(await a.service.status(), id)?.state).toBe('synced')
  })

  it('asks which side to keep when a world exists on both sides and was never synced here', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = 'worlds/harbor'
    await write(a.root, `${id}/world.json`, 'a')
    await write(b.root, `${id}/world.json`, 'b')
    await a.service.run()
    const result = await b.service.run()
    expect(result.units.find(entry => entry.id === id)?.state).toBe('conflict')
    await b.service.resolve(id, 'remote')
    expect(await read(b.root, `${id}/world.json`)).toBe('a')
    expect(unit(await b.service.status(), id)?.state).toBe('synced')
  })

  it('refuses to choose a side for a session that is being played', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await a.service.run()
    await b.service.run()
    await write(a.root, `${id}/session.sqlite`, 'from a')
    await write(b.root, `${id}/session.sqlite`, 'from b')
    await a.service.run()
    await b.service.run()
    b.busy.reason = 'a turn is being played'
    await expect(b.service.resolve(id, 'remote')).rejects.toThrow(/turn is being played/)
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('from b')
  })

  it('pushes again an upload of its own that was cut short instead of calling it a conflict', async () => {
    const a = await device('a')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await a.service.run()
    await write(a.root, `${id}/session.sqlite`, 'two, being uploaded')
    await mkdir(join(remote, '.revisions'), { recursive: true })
    await writeFile(join(remote, '.revisions', `sessions__${SESSION}.json`), JSON.stringify({ rev: 'cut-short', device: readStore(a.root).device, at: new Date().toISOString(), complete: false }))
    const result = await a.service.run()
    expect(result.units[0]?.state).toBe('synced')
    expect(await readFile(join(remote, id, 'session.sqlite'), 'utf8')).toBe('two, being uploaded')
  })

  it('deletes a session everywhere: a tombstone on the remote makes every other device delete its copy', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await a.service.run()
    await b.service.run()

    await a.service.deleteRemote(id)
    await rm(join(a.root, id), { recursive: true })
    expect(await readdir(join(remote, 'sessions'))).toEqual([])
    expect(await readdir(join(remote, '.tombstones'))).toEqual([`${encodeURIComponent(id)}.json`])
    await a.service.run()
    expect(await readdir(join(a.root, 'sessions'))).toEqual([])

    await b.service.run()
    expect(b.removed).toEqual([SESSION])
    expect(await readdir(join(b.root, 'sessions'))).toEqual([])
    expect(unit(await b.service.status(), id)).toBeUndefined()
  })

  it('keeps a session that was deleted here only on the remote, and brings it back when the choice is undone', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = `sessions/${SESSION}`
    await write(a.root, `${id}/session.sqlite`, 'one')
    await a.service.run()
    await b.service.run()

    await rm(join(b.root, id), { recursive: true })
    b.service.forget(id)
    await b.service.run()
    expect(await readdir(join(b.root, 'sessions'))).toEqual([])
    expect(unit(await b.service.status(), id)?.state).toBe('ignored')
    expect(await readFile(join(remote, id, 'session.sqlite'), 'utf8')).toBe('one')

    b.service.restore(id)
    await b.service.run()
    expect(await read(b.root, `${id}/session.sqlite`)).toBe('one')
    expect(unit(await b.service.status(), id)?.state).toBe('synced')
  })

  it('asks what a world removed by hand means, and deletes it everywhere when told so', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = 'worlds/harbor'
    await write(a.root, `${id}/world.json`, 'a')
    await a.service.run()
    await b.service.run()

    await rm(join(b.root, id), { recursive: true })
    const asked = await b.service.run()
    expect(asked.units.find(entry => entry.id === id)).toMatchObject({ state: 'conflict', removal: 'removed' })
    expect(await readFile(join(remote, id, 'world.json'), 'utf8')).toBe('a')

    await b.service.resolve(id, 'remote')
    expect(await read(b.root, `${id}/world.json`)).toBe('a')
    expect(unit(await b.service.status(), id)?.state).toBe('synced')

    await rm(join(b.root, id), { recursive: true })
    await b.service.run()
    await b.service.resolve(id, 'local')
    expect(await readdir(join(remote, 'worlds'))).toEqual([])

    await a.service.run()
    expect(await readdir(join(a.root, 'worlds'))).toEqual([])
    expect(await readdir(join(a.root, '.trash', 'worlds'))).toHaveLength(1)
  })

  it('leaves a world alone that another device deleted but this one changed, until the person chooses', async () => {
    const a = await device('a')
    const b = await device('b')
    const id = 'worlds/harbor'
    await write(a.root, `${id}/world.json`, 'a')
    await a.service.run()
    await b.service.run()
    await a.service.deleteRemote(id)
    await rm(join(a.root, id), { recursive: true })

    await write(b.root, `${id}/world.json`, 'b has kept working')
    const asked = await b.service.run()
    expect(asked.units.find(entry => entry.id === id)).toMatchObject({ state: 'conflict', removal: 'deleted' })
    expect(await read(b.root, `${id}/world.json`)).toBe('b has kept working')

    await b.service.resolve(id, 'local')
    expect(await readFile(join(remote, id, 'world.json'), 'utf8')).toBe('b has kept working')
    expect(await readdir(join(remote, '.tombstones'))).toEqual([])
    await a.service.run()
    expect(await read(a.root, `${id}/world.json`)).toBe('b has kept working')
  })

  it('locks a unit while it syncs', async () => {
    const gate = new UnitGate()
    let inside = false
    const running = gate.hold('worlds/harbor', async () => { inside = true; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(inside).toBe(true)
    expect(gate.isLocked('worlds/harbor')).toBe(true)
    expect(() => { gate.assertFree('worlds/harbor') }).toThrow(UnitLockedError)
    await expect(gate.hold('worlds/harbor', async () => undefined)).rejects.toThrow(UnitLockedError)
    const waiting = gate.whenFree('worlds/harbor')
    await running
    await waiting
    expect(gate.isLocked('worlds/harbor')).toBe(false)
  })
})
