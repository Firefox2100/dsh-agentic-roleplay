import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readZip } from '../../../src/host/catalogue/zip.ts'
import { writeZip } from '../../../src/host/catalogue/zip-write.ts'
import { openSession } from '../../../src/host/sessions/open-session.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { exportSession, importSession, InvalidArchiveError, type ArchiveDeps } from '../../../src/host/sessions/session-archive.ts'

let base: string
let ctx: Context
let fiber: { dispose(): void }
let known: Map<string, string>
const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
const sessionsDir = () => join(base, 'sessions')
const worldsDir = () => join(base, 'worlds')
const deps = (): ArchiveDeps => ({ state: state(), sessionsDir, worldsDir, worldDirectory: id => Promise.resolve(known.get(id)), maxBytes: () => 50_000_000, now: () => new Date('2026-01-02T03:04:05Z') })

function story() {
  mkdirSync(join(worldsDir(), 'salt'), { recursive: true })
  writeFileSync(join(worldsDir(), 'salt', 'world.json'), JSON.stringify({ id: 'salt-id', name: 'Salt Harbor' }))
  mkdirSync(join(worldsDir(), 'salt', '.trash'), { recursive: true })
  writeFileSync(join(worldsDir(), 'salt', '.trash', 'old.json'), '{}')
  const store = state().createSession(sessionsDir(), { name: 'Night — fog', world: { id: 'salt-id', name: 'Salt Harbor', source: 'worlds/salt' } })
  const id = store.metadata.get().id
  const folder = statePlugin.sessionFolder(sessionsDir(), id)
  writeFileSync(join(folder, 'timeline.json'), JSON.stringify({ version: 1, head: null, next: 1, nodes: [] }))
  writeFileSync(join(folder, 'status.json'), JSON.stringify({ archivedAt: 'x' }))
  mkdirSync(join(folder, 'images', 'scenes'), { recursive: true })
  writeFileSync(join(folder, 'images', 'scenes', 'a.png'), Buffer.from([1, 2, 3]))
  mkdirSync(join(folder, '.trash'), { recursive: true })
  writeFileSync(join(folder, '.trash', 'gone.txt'), 'x')
  return { id, folder }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'archive-'))
  ctx = new Context()
  fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
  await new Promise(resolve => setTimeout(resolve, 20))
  known = new Map()
})
afterEach(async () => {
  fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 20))
  await rm(base, { recursive: true, force: true })
})

describe('the zip writer', () => {
  it('writes what the reader reads back, with names in any script', () => {
    const files = new Map([['a/b.txt', Buffer.from('hello hello hello hello')], ['故事.json', Buffer.from('{}')], ['empty', Buffer.alloc(0)]])
    const back = readZip(writeZip(files), { maxBytes: 1000 })
    expect([...back.keys()]).toEqual([...files.keys()])
    for (const [name, content] of files) expect(back.get(name)!.equals(content)).toBe(true)
  })
})

describe('a story archive', () => {
  it('carries the database, the story folder and its world, and leaves out what belongs to this device', () => {
    const { id } = story()
    const { file, bytes } = exportSession(deps(), id)
    expect(file).toBe('Night-fog.dsh-story.zip')
    const names = [...readZip(bytes, { maxBytes: 1_000_000 }).keys()].sort()
    expect(names).toEqual(['manifest.json', 'session/images/scenes/a.png', 'session/session.sqlite', 'session/timeline.json', 'world/world.json'])
    expect(state().snapshots(sessionsDir(), id)).toEqual([])
  })

  it('is put back as a new session with its own identity and the world it carried', async () => {
    const { id } = story()
    const { bytes } = exportSession(deps(), id)
    await rm(join(worldsDir(), 'salt'), { recursive: true, force: true })
    const restored = await importSession(deps(), bytes)
    expect(restored).toMatchObject({ name: 'Night — fog (restored)', worldAdded: true })
    expect(restored.id).not.toBe(id)
    expect(state().openSession(sessionsDir(), restored.id).metadata.get()).toMatchObject({ id: restored.id, name: 'Night — fog (restored)', world: { source: 'worlds/Salt-Harbor' } })
    expect(readFileSync(join(statePlugin.sessionFolder(sessionsDir(), restored.id), 'images', 'scenes', 'a.png'))).toEqual(Buffer.from([1, 2, 3]))
    expect(readFileSync(join(worldsDir(), 'Salt-Harbor', 'world.json'), 'utf8')).toContain('salt-id')
    expect(state().openSession(sessionsDir(), id).metadata.get().name).toBe('Night — fog')
  })

  it('has its earlier turns in the chat that is made when the restored session is first opened', async () => {
    const { id, folder } = story()
    writeFileSync(join(folder, 'opening.json'), JSON.stringify([{ type: 'narration', text: 'Fog on the quay.' }]))
    const output = { segments: [{ type: 'narration', text: 'The bell rings.' }], repaired: false }
    writeFileSync(join(folder, 'timeline.json'), JSON.stringify({ version: 1, head: 'n1', next: 2, nodes: [{ id: 'n1', parent: null, turn: 2, userSeq: 0, player: 'I ring it.', createdAt: 'x', output }] }))
    const restored = await importSession(deps(), exportSession(deps(), id).bytes)
    let logged: readonly { type: string }[] = []
    const opened = await openSession({ state: state(), sessionsDir, agent: { has: () => Promise.resolve(false), ensure: (_id, _name, _opening, events) => { logged = events ?? []; return Promise.resolve('chat') } } }, restored.id)
    expect(opened.chatSessionId).toBe('chat')
    expect(JSON.stringify(logged)).toContain('I ring it.')
    expect(JSON.stringify(logged)).toContain('The bell rings.')
    expect(JSON.parse(readFileSync(join(statePlugin.sessionFolder(sessionsDir(), restored.id), 'timeline.json'), 'utf8')).nodes[0].endSeq).toBeGreaterThan(0)
  })

  it('does not add a world the person already has', async () => {
    const { id } = story()
    const { bytes } = exportSession(deps(), id)
    known.set('salt-id', join(worldsDir(), 'salt'))
    const restored = await importSession(deps(), bytes)
    expect(restored.worldAdded).toBe(false)
    expect(existsSync(join(worldsDir(), 'Salt-Harbor'))).toBe(false)
    expect(state().openSession(sessionsDir(), restored.id).metadata.get().world.source).toBe('worlds/salt')
  })

  it('refuses a file that is not an archive of this program and leaves nothing behind', async () => {
    const other = writeZip(new Map([['manifest.json', Buffer.from(JSON.stringify({ format: 'else', version: 1 }))]]))
    await expect(importSession(deps(), other)).rejects.toThrow(/not a story archive/)
    await expect(importSession(deps(), writeZip(new Map([['a.txt', Buffer.from('x')]])))).rejects.toThrow(/no manifest/)
    await expect(importSession(deps(), Buffer.from('not a zip'))).rejects.toThrow(InvalidArchiveError)
    const manifest = JSON.stringify({ format: 'dsh-agentic-roleplay/session-archive', version: 1, session: { name: 'x' }, world: { id: 'w', name: 'World', included: false } })
    await expect(importSession(deps(), writeZip(new Map([['manifest.json', Buffer.from(manifest)]])))).rejects.toThrow(/no story database/)
    expect(existsSync(sessionsDir()) ? statePlugin.listSessions(sessionsDir()).sessions : []).toEqual([])
  })

  it('refuses an id that names no session', () => {
    expect(() => exportSession(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).toThrow(SessionNotFoundError)
    expect(() => exportSession(deps(), '../x')).toThrow(SessionNotFoundError)
  })
})
