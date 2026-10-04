import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, isSessionId } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSettings } from '../../../src/host/sessions/settings.ts'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { startSession, type StartSessionDeps } from '../../../src/host/sessions/start-session.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let root: string
let state: RoleplayState
let deps: StartSessionDeps
let ensured: [string, string, readonly { type: string; text: string }[] | undefined][]
let retired: string[]
let ensureError: Error | undefined

async function write(path: string, content: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'start-session-'))
  ensured = []
  retired = []
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
      ensure: (id, title, opening) => {
        ensured.push([id, title, opening])
        return ensureError === undefined ? Promise.resolve(`session-${id}`) : Promise.reject(ensureError)
      },
      retire: (id) => { retired.push(id); return Promise.resolve() },
    },
    sessionsDir: () => join(root, 'sessions'),
  }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const playAsArthur = { worldId: 'blackwater', playerCharacterId: 'arthur' }

describe('starting with settings', () => {
  it('writes them into the session before its first message, with what is left out at its default', async () => {
    const started = await startSession(deps, { ...playAsArthur, settings: { maxRounds: 2, memory: { flaky: false }, context: { limitTokens: 8000 } } })
    const settings = readSettings(join(root, 'sessions', started.id))
    expect(settings).toMatchObject({ maxRounds: 2, memory: { flaky: false, recall: 12 }, context: { limitTokens: 8000, retainRatio: 0.5 } })
    expect(ensured).toHaveLength(1)
  })

  it('keeps the options of the embedding provider that the chat chose at start, for the requests it will make', async () => {
    const started = await startSession(deps, { ...playAsArthur, settings: { embedding: { options: { dimensions: 256 } } } })
    expect(readSettings(join(root, 'sessions', started.id)).embedding.options).toEqual({ dimensions: 256 })
  })

  it('has the defaults when none are given, and leaves no file', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(await readdir(join(root, 'sessions', started.id))).toEqual(['session.sqlite'])
  })

  it('refuses settings that are not acceptable, naming them, before anything is created', async () => {
    await expect(startSession(deps, { ...playAsArthur, settings: { maxRounds: 0, colour: 'red' } })).rejects.toThrow(/"colour" is not a setting; "maxRounds" must be a whole number from 1 to 10/)
    expect(ensured).toEqual([])
    expect(await readdir(root)).not.toContain('sessions')
  })
})

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

  it('creates the chat of the new session, named after it', async () => {
    const started = await startSession(deps, { ...playAsArthur, name: 'Night one' })
    expect(ensured).toEqual([[started.id, 'Night one', undefined]])
    expect((await startSession(deps, playAsArthur)).name).toBe('The Blackwater Observatory')
    expect(ensured.at(-1)?.[1]).toBe('The Blackwater Observatory')
  })

  it('starts the chat with the opening of the world, plain text as one narration', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory', opening_message: ' The festival lanterns sway. ' })
    const started = await startSession(deps, playAsArthur)
    expect(ensured).toEqual([[started.id, 'The Blackwater Observatory', [{ type: 'narration', text: 'The festival lanterns sway.' }]]])
  })

  it('names the characters who speak in the opening', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory', opening_message: [
      { type: 'narration', text: 'Dusk.' }, { type: 'utterance', character: 'clara', text: 'You are late.' },
    ] })
    await startSession(deps, playAsArthur)
    expect(ensured[0]?.[2]).toEqual([
      { type: 'narration', text: 'Dusk.' }, { type: 'utterance', character: 'clara', name: 'Clara Whitlock', text: 'You are late.' },
    ])
  })

  it('refuses a world whose opening has someone speak who is not in it, before anything is created', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory', opening_message: [
      { type: 'utterance', character: 'nobody', text: 'Hello.' },
    ] })
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(InvalidWorldError)
    expect(ensured).toEqual([])
    expect(await readdir(root)).not.toContain('sessions')
  })

  it('leaves nothing behind when the chat cannot be created', async () => {
    ensureError = new Error('no session services')
    await expect(startSession(deps, playAsArthur)).rejects.toThrow('no session services')
    expect(await readdir(join(root, 'sessions'))).toEqual([])
    expect(retired).toHaveLength(1)
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

describe('starting in a world with places', () => {
  const world = () => join(root, 'worlds', 'blackwater folder')
  const places = async () => {
    await write(join(world(), 'locations', 'bar', 'location.json'), { id: 'bar', name: 'Iron Stag Bar', description: 'Busy.', parent: 'town', features: [{ id: 'counter', name: 'Counter' }], exits: [{ to: 'street', description: 'the door' }] })
    await write(join(world(), 'locations', 'town', 'location.json'), { id: 'town', name: 'Blackwater Ridge' })
    await write(join(world(), 'locations', 'street', 'location.json'), { id: 'street', name: 'Main Street', parent: 'town' })
  }

  it('creates the places with the ways between them and stands each character where it starts', async () => {
    await places()
    await write(join(world(), 'characters', 'arthur', 'character.json'), { name: 'Arthur Moore', role: 'playable', start: { location: 'bar', position: 'at the bar', feature: 'counter' } })
    const started = await startSession(deps, playAsArthur)
    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.locations.list().map(location => location.sourceId)).toEqual(['town', 'bar', 'street'])
    expect(session.locations.allExits()).toHaveLength(2)
    const arthur = session.characters.getBySourceId('arthur')!
    expect(session.placements.get('character', arthur.id)).toMatchObject({ locationId: session.locations.getBySourceId('bar')!.id, position: 'at the bar', featureKey: 'counter' })
    expect(session.placements.get('character', session.characters.getBySourceId('clara')!.id)).toBeUndefined()
  })

  it('refuses a world whose places have problems, naming them, before anything is created', async () => {
    await write(join(world(), 'locations', 'lost', 'location.json'), { name: 'Lost', parent: 'nowhere' })
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(InvalidWorldError)
    expect(ensured).toEqual([])
    expect(await readdir(root)).not.toContain('sessions')
  })

  it('refuses a character that starts in a place the world does not have, or at a feature the place lacks', async () => {
    await places()
    await write(join(world(), 'characters', 'arthur', 'character.json'), { name: 'Arthur Moore', role: 'playable', start: { location: 'moon' } })
    await write(join(world(), 'characters', 'clara', 'character.json'), { name: 'Clara', start: { location: 'bar', feature: 'piano' } })
    const error = await startSession(deps, playAsArthur).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidWorldError)
    expect((error as InvalidWorldError).problems.map(problem => problem.message)).toEqual([
      'arthur: start.location "moon" is not a place of this world',
      'clara: start.feature "piano" is not a feature of Iron Stag Bar (it has: counter)',
    ])
    expect(ensured).toEqual([])
  })

  it('refuses a character that starts in a place when the world has none', async () => {
    await write(join(world(), 'characters', 'arthur', 'character.json'), { name: 'Arthur Moore', role: 'playable', start: { location: 'bar' } })
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(/starting places/)
  })
})

describe('starting in a world whose characters have relationships', () => {
  it('stores them, and refuses a relationship with someone the world does not have', async () => {
    const characters = join(root, 'worlds', 'blackwater folder', 'characters')
    await write(join(characters, 'clara', 'character.json'), { name: 'Clara Whitlock', relationships: [{ to: 'arthur', label: 'regular', summary: 'Drinks alone.', affinity: 0.4 }] })
    const started = await startSession(deps, playAsArthur)
    const session = state.openSession(join(root, 'sessions'), started.id)
    const [arthur, clara] = [session.characters.getBySourceId('arthur')!, session.characters.getBySourceId('clara')!]
    expect(session.relationships.get(clara.id, arthur.id)).toMatchObject({ label: 'regular', affinity: 0.4 })
    await write(join(characters, 'clara', 'character.json'), { name: 'Clara Whitlock', relationships: [{ to: 'nobody', label: 'x' }] })
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(/relationships of .* have 1 problem/)
  })
})

describe('starting in a world with things', () => {
  const world = () => join(root, 'worlds', 'blackwater folder')

  it('creates the things and the slots where they start, and refuses a world whose things have problems before anything is made', async () => {
    await write(join(world(), 'locations', 'bar', 'location.json'), { id: 'bar', name: 'Bar' })
    await write(join(world(), 'characters', 'arthur', 'character.json'), { name: 'Arthur Moore', role: 'playable', start: { location: 'bar' } })
    await write(join(world(), 'items', 'slots.json'), [{ id: 'quiver', name: 'quiver', capacity: 1 }])
    await write(join(world(), 'items', 'lantern', 'item.json'), { name: 'Lantern', location: 'bar', notable: true })
    await write(join(world(), 'items', 'quiver', 'item.json'), { name: 'Quiver', wearable: 'quiver', worn_by: 'arthur' })
    const started = await startSession(deps, playAsArthur)
    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.items.list().map(entry => entry.name)).toEqual(['Lantern', 'Quiver'])
    expect(session.items.holding(session.items.getBySourceId('quiver')!.id)?.holder).toMatchObject({ mode: 'worn', slot: 'quiver' })
    expect(session.slots.get('quiver')).toBeDefined()
    await write(join(world(), 'items', 'bad', 'item.json'), { name: 'Bad', location: 'moon' })
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(/items of .* have 1 problem/)
  })
})
