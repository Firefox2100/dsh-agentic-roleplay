import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/plugin.ts'
import { ConflictError, NotFoundError, type RoleplayState, type SessionInit } from '../src/index.ts'
import { newCharacter } from './helpers.ts'

let dir: string
let sessionsDir: string
let ctx: Context
let fiber: { dispose(): void }
let id: string

const init: SessionInit = { name: 'First night', world: { id: 'blackwater', name: 'The Blackwater Observatory' } }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))
const state = (): RoleplayState => (ctx as unknown as { roleplayState: RoleplayState }).roleplayState

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'state-snapshots-'))
  sessionsDir = join(dir, 'sessions')
  ctx = new Context()
  fiber = ctx.plugin(plugin as never, {} as never) as unknown as { dispose(): void }
  await settle()
  const session = state().createSession(sessionsDir, init)
  id = session.metadata.get().id
  session.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [] }))
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'The Bar' }], events: [{ turn: 1, round: 1, text: 'Alice hid the brass key.', importance: 3, tags: ['key'], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
})
afterEach(async () => {
  fiber.dispose()
  await settle()
  await rm(dir, { recursive: true, force: true })
})

describe('snapshots of a session', () => {
  it('keeps a consistent copy of the whole database under a name, replaces one of the same name, and lists and removes them', async () => {
    state().snapshot(sessionsDir, id, 'after-1')
    expect(state().snapshots(sessionsDir, id)).toEqual(['after-1'])
    state().openSession(sessionsDir, id).edit({ turn: 2, places: [{ key: 'cellar', name: 'Cellar' }] })
    state().snapshot(sessionsDir, id, 'after-2')
    state().snapshot(sessionsDir, id, 'after-1')
    expect(state().snapshots(sessionsDir, id)).toEqual(['after-1', 'after-2'])
    expect(await readdir(join(sessionsDir, id, 'snapshots'))).toEqual(['after-1.sqlite', 'after-2.sqlite'])
    state().removeSnapshot(sessionsDir, id, 'after-2')
    state().removeSnapshot(sessionsDir, id, 'after-2')
    expect(state().snapshots(sessionsDir, id)).toEqual(['after-1'])
  })

  it('only takes names of lowercase letters, digits and hyphens, which cannot leave the folder', () => {
    for (const name of ['', 'Up', '../x', 'a/b', 'a.b', 'a b']) expect(() => state().snapshot(sessionsDir, id, name)).toThrow(RangeError)
  })

  it('is put back as the database: what came after is gone, what was kept is there, search included, and the session opens again', () => {
    state().snapshot(sessionsDir, id, 'before-cellar')
    const session = state().openSession(sessionsDir, id)
    session.edit({ turn: 2, places: [{ key: 'cellar', name: 'Cellar' }], events: [{ turn: 2, round: 1, text: 'Alice went down to the cellar.', importance: 3, tags: ['cellar'], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    expect(session.locations.getBySourceId('cellar')).toBeDefined()
    expect(session.recallIndex.lexical({ text: 'cellar', limit: 5 }).length).toBeGreaterThan(0)
    state().restore(sessionsDir, id, 'before-cellar')
    const restored = state().openSession(sessionsDir, id)
    expect(restored).not.toBe(session)
    expect(restored.locations.getBySourceId('cellar')).toBeUndefined()
    expect(restored.locations.getBySourceId('bar')).toBeDefined()
    expect(restored.events.list().map(event => event.text)).toEqual(['Alice hid the brass key.'])
    expect(restored.recallIndex.lexical({ text: 'cellar', limit: 5 })).toEqual([])
    expect(restored.recallIndex.lexical({ text: 'brass', limit: 5 }).length).toBeGreaterThan(0)
    expect(restored.metadata.get().id).toBe(id)
    restored.edit({ turn: 2, places: [{ key: 'attic', name: 'Attic' }] })
    expect(restored.locations.getBySourceId('attic')).toBeDefined()
  })

  it('refuses a snapshot there is not, and changes nothing', () => {
    expect(() => state().restore(sessionsDir, id, 'nothing')).toThrow(NotFoundError)
    expect(state().openSession(sessionsDir, id).locations.getBySourceId('bar')).toBeDefined()
  })

  it('is taken of a session that is not open, too, and removed with the session', () => {
    state().closeSession(sessionsDir, id)
    state().snapshot(sessionsDir, id, 'cold')
    expect(state().snapshots(sessionsDir, id)).toEqual(['cold'])
    state().deleteSession(sessionsDir, id)
    expect(state().snapshots(sessionsDir, id)).toEqual([])
  })
})

describe('a session made from another', () => {
  const copy = '7c1f0b52-3a64-4c6e-9d3e-0a1b2c3d4e5f'

  it('has the state of the snapshot, a folder of its own with the kept snapshots and the settings, and an identity of its own', async () => {
    state().snapshot(sessionsDir, id, 'after-1')
    state().snapshot(sessionsDir, id, 'start')
    state().openSession(sessionsDir, id).edit({ turn: 2, places: [{ key: 'cellar', name: 'Cellar' }] })
    await writeFile(join(sessionsDir, id, 'settings.json'), '{"maxRounds":2}')
    state().fork(sessionsDir, id, copy, { snapshot: 'after-1' }, { name: 'Branch', keep: ['start'] })
    const branch = state().openSession(sessionsDir, copy)
    expect(branch.metadata.get()).toMatchObject({ id: copy, name: 'Branch' })
    expect(branch.locations.getBySourceId('bar')).toBeDefined()
    expect(branch.locations.getBySourceId('cellar')).toBeUndefined()
    expect(state().snapshots(sessionsDir, copy)).toEqual(['start'])
    expect(await readFile(join(sessionsDir, copy, 'settings.json'), 'utf8')).toBe('{"maxRounds":2}')
    expect(state().openSession(sessionsDir, id).metadata.get().name).toBe('First night')
    expect(state().openSession(sessionsDir, id).locations.getBySourceId('cellar')).toBeDefined()
  })

  it('can be made from the database as it is', () => {
    state().openSession(sessionsDir, id).edit({ turn: 2, places: [{ key: 'cellar', name: 'Cellar' }] })
    state().fork(sessionsDir, id, copy, { live: true }, { name: 'Branch', keep: [] })
    expect(state().openSession(sessionsDir, copy).locations.getBySourceId('cellar')).toBeDefined()
  })

  it('keeps its own identity when a snapshot of the other is put back', () => {
    state().snapshot(sessionsDir, id, 'after-1')
    state().fork(sessionsDir, id, copy, { snapshot: 'after-1' }, { name: 'Branch', keep: ['after-1'] })
    state().restore(sessionsDir, copy, 'after-1')
    expect(state().openSession(sessionsDir, copy).metadata.get()).toMatchObject({ id: copy, name: 'Branch' })
  })

  it('leaves nothing behind when it cannot be made, and refuses an id that exists', () => {
    state().snapshot(sessionsDir, id, 'after-1')
    expect(() => state().fork(sessionsDir, id, copy, { snapshot: 'after-1' }, { name: 'Branch', keep: ['missing'] })).toThrow(NotFoundError)
    expect(existsSync(join(sessionsDir, copy))).toBe(false)
    expect(() => state().fork(sessionsDir, id, copy, { snapshot: 'nothing' }, { name: 'Branch', keep: [] })).toThrow(NotFoundError)
    state().fork(sessionsDir, id, copy, { live: true }, { name: 'Branch', keep: [] })
    expect(() => state().fork(sessionsDir, id, copy, { live: true }, { name: 'Again', keep: [] })).toThrow(ConflictError)
    expect(state().openSession(sessionsDir, copy).metadata.get().name).toBe('Branch')
  })
})
