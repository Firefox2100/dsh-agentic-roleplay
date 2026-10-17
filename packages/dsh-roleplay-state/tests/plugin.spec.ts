import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/plugin.ts'
import { NotFoundError, type SessionInit } from '../src/index.ts'
import { newCharacter } from './helpers.ts'

let dir: string
let sessionsDir: string
let ctx: Context
let fiber: { dispose(): void }

const init: SessionInit = { name: 'First night', world: { id: 'blackwater', name: 'The Blackwater Observatory' } }

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

async function load(config: object = {}): Promise<void> {
  ctx = new Context()
  fiber = ctx.plugin(plugin as never, config as never) as unknown as { dispose(): void }
  await settle()
}

/** Plugins unload asynchronously. */
async function unload(): Promise<void> {
  fiber.dispose()
  await settle()
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'state-plugin-'))
  sessionsDir = join(dir, 'sessions')
  await load()
})
afterEach(async () => {
  await unload()
  await rm(dir, { recursive: true, force: true })
})

describe('plugin', () => {
  it('provides the roleplayState service to other plugins', () => {
    expect(ctx.roleplayState).toBeInstanceOf(plugin.RoleplayState)
  })

  it('has a configuration with a single-file journal by default', () => {
    const parse = plugin.Config as unknown as (value: unknown) => unknown
    expect(parse({})).toEqual({ journalMode: 'delete', writeTools: false, diceTools: false })
    expect(parse({ journalMode: 'wal' })).toEqual({ journalMode: 'wal', writeTools: false, diceTools: false })
    expect(() => parse({ journalMode: 'nope' })).toThrow()
  })
})

describe('RoleplayState', () => {
  it('creates a session and lets the caller fill it through the repositories', () => {
    const session = ctx.roleplayState.createSession(sessionsDir, init)
    const character = session.characters.add(newCharacter())
    session.characterStates.create(character.id, { publicState: 'a', innerState: 'b', activity: 'c' })
    expect(session.characters.get(character.id)?.name).toBe('Eleanor Graves')
  })

  it('hands out a session without a way to close its shared connection', () => {
    const session = ctx.roleplayState.createSession(sessionsDir, init)
    expect('close' in session).toBe(false)
  })

  it('shares one connection per session, however it is reached', () => {
    const created = ctx.roleplayState.createSession(sessionsDir, init)
    const { id } = created.metadata.get()
    expect(ctx.roleplayState.openSession(sessionsDir, id)).toBe(created)
  })

  it('keeps the session on disk when its connection is released, and reconnects', () => {
    const created = ctx.roleplayState.createSession(sessionsDir, init)
    const { id } = created.metadata.get()
    created.characters.add(newCharacter())
    ctx.roleplayState.closeSession(sessionsDir, id)
    expect(() => created.characters.list()).toThrow()
    const again = ctx.roleplayState.openSession(sessionsDir, id)
    expect(again).not.toBe(created)
    expect(again.characters.list()).toHaveLength(1)
  })

  it('does not open a session that does not exist', () => {
    expect(() => ctx.roleplayState.openSession(sessionsDir, '3f2b8c1e-1c1a-4a4e-9d0f-2d8f9b6a7c11')).toThrow(NotFoundError)
  })

  it('deletes a session, closing it first', async () => {
    const session = ctx.roleplayState.createSession(sessionsDir, init)
    const { id } = session.metadata.get()
    ctx.roleplayState.deleteSession(sessionsDir, id)
    expect(await readdir(sessionsDir)).toEqual([])
    expect(() => session.characters.list()).toThrow()
  })

  it('closes every connection when the plugin unloads', async () => {
    const one = ctx.roleplayState.createSession(sessionsDir, init)
    const two = ctx.roleplayState.createSession(sessionsDir, init)
    await unload()
    expect(() => one.characters.list()).toThrow()
    expect(() => two.characters.list()).toThrow()
  })

  it('works with the write-ahead journal too', async () => {
    await unload()
    await load({ journalMode: 'wal' })
    const session = ctx.roleplayState.createSession(sessionsDir, init)
    session.characters.add(newCharacter())
    expect(session.characters.list()).toHaveLength(1)
  })

  it('lists sessions, including ones that are open, and reports unreadable ones', async () => {
    const open = ctx.roleplayState.createSession(sessionsDir, { ...init, name: 'Open one' })
    open.metadata.recordTurn()
    ctx.roleplayState.closeSession(sessionsDir, open.metadata.get().id)
    const reopened = ctx.roleplayState.createSession(sessionsDir, { ...init, name: 'Still open' })
    const { sessions, problems } = ctx.roleplayState.listSessions(sessionsDir)
    expect(problems).toEqual([])
    expect(sessions.map(session => session.name).sort()).toEqual(['Open one', 'Still open'])
    expect(sessions.find(session => session.name === 'Open one')?.turns).toBe(1)
    expect(reopened.characters.list()).toEqual([])
  })
})
