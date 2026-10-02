import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, isSessionId } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { startSession, type StartSessionDeps } from '../../../src/host/sessions/start-session.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let root: string
let state: RoleplayState
let deps: StartSessionDeps
let ensured: string[]
let ensureError: Error | undefined

async function write(path: string, content: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'start-session-'))
  ensured = []
  ensureError = undefined
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory' })
  const characters = join(root, 'worlds', 'blackwater folder', 'characters')
  await write(join(characters, 'arthur', 'character.json'), {
    name: 'Arthur Moore', role: 'playable',
    start: { public_state: 'Arriving.', intents: [{ name: 'Investigate' }] },
  })
  await write(join(characters, 'clara', 'character.json'), { name: 'Clara Whitlock', aliases: ['Clara'] })
  await write(join(characters, 'marcus', 'character.json'), { name: 'Marcus Reed', role: 'playable' })
  deps = {
    worlds: new WorldCatalog(new Context(), { path: root } as RoleplayRoot),
    state,
    agent: {
      ensure: (id) => {
        ensured.push(id)
        return ensureError === undefined ? Promise.resolve(`session-${id}`) : Promise.reject(ensureError)
      },
    },
    sessionsDir: () => join(root, 'sessions'),
  }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const playAsArthur = { worldId: 'blackwater', playerCharacterId: 'arthur' }

describe('startSession', () => {
  it('creates a session folder and fills the database from the world', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(isSessionId(started.id)).toBe(true)
    expect(started).toEqual({ id: started.id, chatSessionId: `session-${started.id}`, name: 'The Blackwater Observatory', worldId: 'blackwater', worldName: 'The Blackwater Observatory', characterCount: 3 })
    expect(await readdir(join(root, 'sessions'))).toEqual([started.id])
    expect(await readdir(join(root, 'sessions', started.id))).toEqual(['session.sqlite'])

    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.metadata.get()).toMatchObject({
      id: started.id,
      name: 'The Blackwater Observatory',
      turns: 0,
      world: { id: 'blackwater', name: 'The Blackwater Observatory', source: 'worlds/blackwater folder' },
    })
    expect(session.characters.list().map(character => [character.sourceId, character.name, character.role, character.control])).toEqual([
      ['arthur', 'Arthur Moore', 'playable', 'player'],
      ['clara', 'Clara Whitlock', 'npc', 'agent'],
      ['marcus', 'Marcus Reed', 'playable', 'agent'],
    ])
    const arthur = session.characters.getBySourceId('arthur')
    expect(session.characterStates.get(arthur?.id ?? 0)?.publicState).toBe('Arriving.')
    expect(session.intents.list(arthur?.id ?? 0).map(intent => intent.name)).toEqual(['Investigate'])
  })

  it('creates the chat of the new session', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(ensured).toEqual([started.id])
  })

  it('leaves nothing behind when the chat cannot be created', async () => {
    ensureError = new Error('no session services')
    await expect(startSession(deps, playAsArthur)).rejects.toThrow('no session services')
    expect(await readdir(join(root, 'sessions'))).toEqual([])
  })

  it('lets the player choose which playable character to take', async () => {
    const started = await startSession(deps, { worldId: 'blackwater', playerCharacterId: 'marcus' })
    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.characters.list({ control: 'player' }).map(character => character.sourceId)).toEqual(['marcus'])
  })

  it('names the session as asked, or after the world when the name is blank', async () => {
    const named = await startSession(deps, { ...playAsArthur, name: '  Night one  ' })
    expect(named.name).toBe('Night one')
    expect(state.openSession(join(root, 'sessions'), named.id).metadata.get().name).toBe('Night one')
    expect((await startSession(deps, { ...playAsArthur, name: '   ' })).name).toBe('The Blackwater Observatory')
  })

  it('starts an independent session every time', async () => {
    const first = await startSession(deps, playAsArthur)
    const second = await startSession(deps, playAsArthur)
    expect(second.id).not.toBe(first.id)
    expect((await readdir(join(root, 'sessions'))).sort()).toEqual([first.id, second.id].sort())
  })

  it('does not change the world', async () => {
    const before = await readdir(join(root, 'worlds', 'blackwater folder'))
    await startSession(deps, playAsArthur)
    expect(await readdir(join(root, 'worlds', 'blackwater folder'))).toEqual(before)
  })

  it('refuses an unknown world without creating anything', async () => {
    await expect(startSession(deps, { ...playAsArthur, worldId: 'nope' })).rejects.toBeInstanceOf(WorldNotFoundError)
    await expect(readdir(join(root, 'sessions'))).rejects.toThrow()
  })

  it('refuses a world whose characters cannot be read, reporting why, and creates nothing', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'characters', 'broken', 'character.json'), '{ "age": -1 }')
    const error = await startSession(deps, playAsArthur).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidWorldError)
    expect((error as InvalidWorldError).problems.map(problem => problem.message).sort()).toEqual([
      'age: must be a string or a non-negative number',
      'name: is required',
    ])
    await expect(readdir(join(root, 'sessions'))).rejects.toThrow()
  })

  it.each([
    ['a character the world does not have', { ...playAsArthur, playerCharacterId: 'nobody' }, 'has no character "nobody"'],
    ['a character that is not playable', { ...playAsArthur, playerCharacterId: 'clara' }, 'Clara Whitlock cannot be played'],
    ['a name that is too long', { ...playAsArthur, name: 'x'.repeat(201) }, 'at most 200 characters'],
  ])('refuses %s without creating anything', async (_label, request, message) => {
    const error = await startSession(deps, request).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidStartError)
    expect((error as Error).message).toContain(message)
    await expect(readdir(join(root, 'sessions'))).rejects.toThrow()
  })

  it('removes the session again when filling it fails', async () => {
    const failing: StartSessionDeps = {
      ...deps,
      state: {
        createSession: (dir, init) => ({ ...state.createSession(dir, init), transaction: () => { throw new Error('disk full') } }),
        deleteSession: (dir, id) => { state.deleteSession(dir, id) },
      },
    }
    await expect(startSession(failing, playAsArthur)).rejects.toThrow('disk full')
    expect(await readdir(join(root, 'sessions'))).toEqual([])
  })

  it('cannot start a world that has no characters, as there is nobody to play', async () => {
    await rm(join(root, 'worlds', 'blackwater folder', 'characters'), { recursive: true })
    await expect(startSession(deps, playAsArthur)).rejects.toBeInstanceOf(InvalidStartError)
  })
})
