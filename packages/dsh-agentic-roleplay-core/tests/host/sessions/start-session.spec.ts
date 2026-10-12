import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, isSessionId } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
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

  it('has the defaults when none are given, with the time zone chosen', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(readSettings(join(root, 'sessions', started.id))).toEqual({ ...DEFAULT_SETTINGS, clock: { ...DEFAULT_SETTINGS.clock, timeZone: 'UTC' } })
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
    expect((await readdir(join(root, 'sessions', started.id))).sort()).toEqual(['session.sqlite', 'settings.json'])

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

  it('copies authored visual identity and its canonical portrait into the independent session', async () => {
    const characterFile = join(root, 'worlds', 'blackwater folder', 'characters', 'arthur', 'character.json')
    await write(characterFile, { name: 'Arthur Moore', role: 'playable', visual_identity: { description: 'A weathered face.', tags: ['grey coat'], negative_tags: ['hat'], global_id: 'person-arthur' } })
    const portrait = join(root, 'worlds', 'blackwater folder', 'images', 'global', 'person-arthur', 'reference.png')
    await write(portrait, 'portrait')
    const started = await startSession(deps, playAsArthur)
    const session = state.openSession(join(root, 'sessions'), started.id)
    const arthur = session.characters.getBySourceId('arthur')!
    expect(session.visualIdentities.get('character', arthur.id)).toMatchObject({ description: 'A weathered face.', tags: ['grey coat'], negativeTags: ['hat'], globalId: 'person-arthur', version: 1 })
    expect(await readFile(join(root, 'sessions', started.id, 'images', 'global', 'person-arthur', 'reference.png'), 'utf8')).toBe('portrait')
  })

  it('creates the chat of the new session, named after it', async () => {
    const started = await startSession(deps, { ...playAsArthur, name: 'Night one' })
    expect(ensured).toEqual([[started.id, 'Night one', [{ type: 'narration', text: 'The story begins.' }]]])
    expect((await startSession(deps, playAsArthur)).name).toBe('The Blackwater Observatory')
    expect(ensured.at(-1)?.[1]).toBe('The Blackwater Observatory')
  })

  it('starts the chat with the opening of the world, plain text as one narration', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory', opening_message: ' The festival lanterns sway. ' })
    const started = await startSession(deps, playAsArthur)
    expect(ensured).toEqual([[started.id, 'The Blackwater Observatory', [{ type: 'narration', text: 'The festival lanterns sway.' }]]])
  })

  it('starts with an alternate opening the player chose, and refuses one the world does not have', async () => {
    await write(join(root, 'worlds', 'blackwater folder', 'world.json'), { id: 'blackwater', name: 'The Blackwater Observatory', opening_message: 'The lanterns sway.', alternate_openings: [{ title: 'Arriving late', text: 'You arrive after dark.' }, { text: 'It is already morning.' }] })
    const started = await startSession(deps, { ...playAsArthur, opening: 1 })
    expect(ensured).toEqual([[started.id, 'The Blackwater Observatory', [{ type: 'narration', text: 'It is already morning.' }]]])
    await expect(startSession(deps, { ...playAsArthur, opening: 2 })).rejects.toThrow(/no alternate opening 2/)
    await expect(startSession(deps, { ...playAsArthur, opening: -1 })).rejects.toThrow(InvalidStartError)
    expect(ensured).toHaveLength(1)
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

describe('the rules of the world', () => {
  const world = () => join(root, 'worlds', 'blackwater folder', 'world.json')

  it('are copied into the session at the start, so that it holds them without the world\'s files', async () => {
    await write(world(), { id: 'blackwater', name: 'B', rules: ['There is no magic.', 'Guns do not exist.'] })
    const started = await startSession(deps, playAsArthur)
    expect(state.openSession(join(root, 'sessions'), started.id).metadata.getValue('rules')).toEqual(['There is no magic.', 'Guns do not exist.'])
  })

  it('leave a session with none when the world states none', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(state.openSession(join(root, 'sessions'), started.id).metadata.getValue('rules')).toBeUndefined()
  })
})

describe('starting the clock', () => {
  const wall = Date.UTC(2026, 6, 1, 9, 17, 42)
  const world = () => join(root, 'worlds', 'blackwater folder', 'world.json')
  const clockOf = async (started: { id: string }) => state.openSession(join(root, 'sessions'), started.id).clock.get()

  beforeEach(() => { deps = { ...deps, now: () => wall } })

  it('starts simulated time at the starting time of the world, read in its zone', async () => {
    await write(world(), { id: 'blackwater', name: 'B', time_zone: 'Asia/Shanghai', starting_time: '1912-09-21T19:30' })
    const started = await startSession(deps, playAsArthur)
    expect(await clockOf(started)).toEqual({ mode: 'simulated', now: Date.UTC(1912, 8, 21, 11, 30) })
    expect(readSettings(join(root, 'sessions', started.id)).clock.timeZone).toBe('Asia/Shanghai')
  })

  it('starts at the time the player chose, read in the story\'s zone, instead of the world\'s', async () => {
    await write(world(), { id: 'blackwater', name: 'B', time_zone: 'Asia/Shanghai', starting_time: '1912-09-21T19:30' })
    const started = await startSession(deps, { ...playAsArthur, startingTime: '1912-10-01T08:00' })
    expect(await clockOf(started)).toEqual({ mode: 'simulated', now: Date.UTC(1912, 9, 1, 0, 0) })
    await expect(startSession(deps, { ...playAsArthur, startingTime: 'tomorrow-ish' })).rejects.toThrow(/starting time/)
    await expect(startSession(deps, { ...playAsArthur, startingTime: '1912-10-01T08:00', settings: { clock: { mode: 'real' } } })).rejects.toThrow(/wall clock/)
  })

  it('starts at the minute it is when the world says nothing, and in UTC', async () => {
    const started = await startSession(deps, playAsArthur)
    expect(await clockOf(started)).toEqual({ mode: 'simulated', now: Date.UTC(2026, 6, 1, 9, 17) })
    expect(readSettings(join(root, 'sessions', started.id)).clock.timeZone).toBe('UTC')
  })

  it('follows the wall clock from now, in the zone of this computer unless one is chosen, whatever the world says', async () => {
    await write(world(), { id: 'blackwater', name: 'B', time_zone: 'Asia/Shanghai', starting_time: '1912-09-21T19:30' })
    const started = await startSession(deps, { ...playAsArthur, settings: { clock: { mode: 'real' } } })
    expect(await clockOf(started)).toEqual({ mode: 'real', now: wall })
    expect(readSettings(join(root, 'sessions', started.id)).clock.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const chosen = await startSession(deps, { ...playAsArthur, settings: { clock: { mode: 'real', timeZone: 'Europe/London' } } })
    expect(readSettings(join(root, 'sessions', chosen.id)).clock.timeZone).toBe('Europe/London')
  })

  it('refuses a time zone that is not one, before anything is created', async () => {
    await expect(startSession(deps, { ...playAsArthur, settings: { clock: { timeZone: 'Mars/Olympus' } } })).rejects.toThrow(/clock.timeZone/)
    expect(await readdir(root)).not.toContain('sessions')
  })
})

describe('the triggers of a world', () => {
  const triggers = join('worlds', 'blackwater folder', 'triggers.json')
  const storm = { key: 'storm', name: 'The storm', when: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: 'Thunder rolls over the ridge.' }, { type: 'cue', audience: { characters: ['clara'] }, text: 'The shutters rattle.' }] }

  it('are made in the session, dormant, as the world wrote them', async () => {
    await write(join(root, triggers), [storm])
    const started = await startSession(deps, playAsArthur)
    const session = state.openSession(join(root, 'sessions'), started.id)
    expect(session.triggers.list()).toMatchObject([{ key: 'storm', name: 'The storm', origin: 'world', status: 'dormant', fireCount: 0, createdTurn: 0 }])
  })

  it('refuse the start, naming what they name that the world does not have, before anything is created', async () => {
    await write(join(root, triggers), [{ ...storm, when: { type: 'place', character: 'clara', location: 'moon' } }, { ...storm, key: 'late', when: { type: 'fired', trigger: 'ghost' }, effects: [{ type: 'cue', audience: { characters: ['zed'] }, text: 'x' }] }])
    const error = await startSession(deps, playAsArthur).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidWorldError)
    expect((error as InvalidWorldError).problems.map(problem => problem.message)).toEqual(expect.arrayContaining([
      'storm: when: there is no place "moon"', 'late: when: there is no trigger "ghost"', 'late: effects[0]: there is no character "zed"',
    ]))
    expect(ensured).toEqual([])
    expect(await readdir(join(root, 'sessions'))).toEqual([])
  })

  it('refuse the start when the file has problems, reported with the file', async () => {
    await write(join(root, triggers), '[{"key":"x"}]')
    await expect(startSession(deps, playAsArthur)).rejects.toThrow(/triggers of "The Blackwater Observatory" have \d+ problem/)
  })
})

describe('starting with player avatars', () => {
  async function avatarsDeps() {
    const { avatarsWorld, createAvatar } = await import('../../../src/host/avatars/avatars.ts')
    const avatars = await avatarsWorld(root)
    await createAvatar(avatars, 'Mira')
    await createAvatar(avatars, 'Arthur')
    deps = { ...deps, avatars: () => avatarsWorld(root) }
  }

  it('brings the avatars into the session as characters, and lets the player take one of them; the world is not changed', async () => {
    await avatarsDeps()
    const started = await startSession(deps, { worldId: 'blackwater', playerAvatar: 'mira', avatars: ['mira', 'arthur'] })
    const session = state.openSession(join(root, 'sessions'), started.id)
    const cast = session.characters.list().map(character => [character.sourceId, character.control])
    expect(cast).toEqual(expect.arrayContaining([['mira', 'player'], ['arthur-2', 'agent'], ['arthur', 'agent']]))
    expect(started.characterCount).toBe(5)
    expect(await readdir(join(root, 'worlds', 'blackwater folder', 'characters'))).not.toContain('mira')
  })

  it('refuses when neither or both of the player choices are given, or an avatar that is not brought along', async () => {
    await avatarsDeps()
    await expect(startSession(deps, { worldId: 'blackwater' })).rejects.toThrow(InvalidStartError)
    await expect(startSession(deps, { worldId: 'blackwater', playerCharacterId: 'arthur', playerAvatar: 'mira', avatars: ['mira'] })).rejects.toThrow(InvalidStartError)
    await expect(startSession(deps, { worldId: 'blackwater', playerAvatar: 'mira', avatars: ['arthur'] })).rejects.toThrow(/not among the avatars/)
    expect(ensured).toEqual([])
    expect(await readdir(root)).not.toContain('sessions')
  })
})
