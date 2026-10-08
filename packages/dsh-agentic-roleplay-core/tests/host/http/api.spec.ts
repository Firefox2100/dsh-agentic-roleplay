import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from '../../../src/host/http/api.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { DEFAULT_SETTINGS, SETTINGS_SPEC } from '../../../src/shared/settings.ts'
import { InvalidSettingsError } from '../../../src/host/sessions/settings.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { AgentUnavailableError, SessionArchivedError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { TimelineError } from '../../../src/host/timeline/service.ts'
import type { StartSessionRequest } from '../../../src/shared/sessions.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { API_PREFIX } from '../../../src/shared/worlds.ts'

let base: string
let server: Server
let origin: string
let allowed = true
let startedWith: StartSessionRequest | undefined
let startError: Error | undefined
let charactersError: Error | undefined
let deleted: string | undefined
let deleteError: Error | undefined
let opened: string | undefined
let openError: Error | undefined
let settingsError: Error | undefined
let notesError: Error | undefined
let timelineError: Error | undefined
let archiveError: Error | undefined
let editorError: Error | undefined
let edited: string[] = []
let archived: string[] = []
let moved: [string, string] | undefined
let writtenSettings: unknown
const started = { id: 'session-id', chatSessionId: 'session-session-id', name: 'Harbor', worldId: 'harbor', worldName: 'Harbor', characterCount: 2 }
const listed = { directory: '/root/sessions', sessions: [{ id: 'session-id', chatSessionId: 'session-session-id', name: 'Harbor', worldId: 'harbor', worldName: 'Harbor', createdAt: '2026-01-01T00:00:00.000Z', turns: 0 }], problems: [] }
const cast = { characters: [{ id: 'arthur', name: 'Arthur', summary: '', role: 'playable' as const, tier: 'principal' as const, kind: 'person' as const }], problems: [] }

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'api-'))
  allowed = true
  startedWith = undefined
  startError = undefined
  charactersError = undefined
  deleted = undefined
  deleteError = undefined
  opened = undefined
  openError = undefined
  settingsError = undefined
  notesError = undefined
  timelineError = undefined
  moved = undefined
  archiveError = undefined
  editorError = undefined
  edited = []
  archived = []
  writtenSettings = undefined
  const folder = join(base, 'worlds', 'harbor')
  await mkdir(join(folder, 'media', 'files'), { recursive: true })
  await writeFile(join(folder, 'world.json'), JSON.stringify({ id: 'harbor', name: 'Harbor', metadata: { tags: ['noir'] }, cover_media_id: 'm' }))
  await writeFile(join(folder, 'media', 'manifest.jsonl'), '{"id":"m","file":"media/files/m.png"}\n')
  await writeFile(join(folder, 'media', 'files', 'm.png'), 'png-bytes')
  await writeFile(join(base, 'worlds', 'secret.png'), 'secret')

  const worlds = new WorldCatalog(new Context(), { path: base } as RoleplayRoot)
  const handler = createApiHandler({
    speech: { voices: async () => [{ id: 'clara', name: 'Clara' }], speak: async () => ({ bytes: new Uint8Array([1, 2]), mediaType: 'audio/mpeg' }), streaming: () => true },
    worlds,
    worldCharacters: async () => {
      if (charactersError !== undefined) throw charactersError
      return cast
    },
    worldEditor: {
      read: (worldId) => {
        if (editorError !== undefined) return Promise.reject(editorError)
        return Promise.resolve({ characters: [], places: [{ key: worldId, name: 'Bar', description: '', features: [] }], things: [], factions: [], relations: [] })
      },
      editCharacter: (worldId, key, edit) => {
        if (editorError !== undefined) return Promise.reject(editorError)
        edited.push(`${worldId} ${key} ${JSON.stringify(edit)}`)
        return Promise.resolve({ characters: [], places: [], things: [], factions: [], relations: [] })
      },
      editPlace: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editThing: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editFaction: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editLore: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editRelation: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editNarrationVoice: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      generatePortrait: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      portraitFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
    },
    sessions: {
      list: () => listed,
      editCharacter: (id, key, edit) => {
        if (archiveError !== undefined) throw archiveError
        edited.push(`${id} ${key} ${JSON.stringify(edit)}`)
        return { characters: [], places: [], things: [], factions: [], relations: [] }
      },
      editPlace: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editThing: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editFaction: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editLore: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editRelation: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      editNarrationVoice: () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      generatePortrait: async () => ({ characters: [], places: [], things: [], factions: [], relations: [] }),
      portraitFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
      start: async (request) => {
        startedWith = request
        if (startError !== undefined) throw startError
        return started
      },
      open: (id) => {
        if (openError !== undefined) return Promise.reject(openError)
        opened = id
        return Promise.resolve({ id, chatSessionId: `session-${id}` })
      },
      readSettings: () => {
        if (settingsError !== undefined) throw settingsError
        return { settings: DEFAULT_SETTINGS, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0 }
      },
      writeSettings: (_id, value) => {
        if (settingsError !== undefined) throw settingsError
        writtenSettings = value
        return { settings: { ...DEFAULT_SETTINGS, maxRounds: (value as { maxRounds: number }).maxRounds }, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0 }
      },
      timeline: (id) => {
        if (timelineError !== undefined) throw timelineError
        return { head: 'n2', path: [{ id: 'n1', turn: 1, player: `from ${id}`, restorable: true, alternatives: ['n1'] }], forward: [], canStart: true, withdrawn: [] }
      },
      moveTimeline: (id, to) => {
        if (timelineError !== undefined) return Promise.reject(timelineError)
        moved = [id, to]
        return Promise.resolve(to === 'start' ? { draft: 'the first message' } : {})
      },
      notes: (id) => {
        if (notesError !== undefined) throw notesError
        return [{ kind: 'suggestions', turn: 2, lines: [`from ${id}`] }]
      },
      imageStatus: id => Promise.resolve({ node: 'n2', mode: 'manual', state: 'absent', images: [], message: id }),
      generateImage: () => Promise.resolve({ node: 'n2', mode: 'manual', state: 'generating', images: [] }),
      imageFile: () => Promise.resolve({ file: join(base, 'worlds', 'harbor', 'media', 'files', 'm.png'), size: 9 }),
      world: (id) => {
        if (archiveError !== undefined) throw archiveError
        return { characters: [{ key: id, name: 'Clara', aliases: [], role: 'npc', tier: 'principal', kind: 'person', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, state: { publicState: '', innerState: '', activity: '' }, goals: [] }], places: [], things: [], factions: [], relations: [] }
      },
      rename: (id, name) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`rename ${id} ${name}`)
        return Promise.resolve()
      },
      archive: (id) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`archive ${id}`)
        return Promise.resolve()
      },
      restore: (id) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`restore ${id}`)
        return Promise.resolve()
      },
      delete: (id) => {
        if (deleteError !== undefined) return Promise.reject(deleteError)
        deleted = id
        return Promise.resolve()
      },
    },
    connection: { requestRejection: () => (allowed ? undefined : 401) },
  })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${API_PREFIX}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(base, { recursive: true, force: true })
})

describe('roleplay API', () => {
  it('lists voices and returns synthesized audio', async () => {
    expect(await (await fetch(`${origin}/speech/capabilities`)).json()).toEqual({ streaming: true })
    const voices = await fetch(`${origin}/speech/voices`)
    expect(await voices.json()).toEqual([{ id: 'clara', name: 'Clara' }])
    const audio = await fetch(`${origin}/speech/synthesize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts: [{ text: 'Hello.', voice: 'clara' }] }) })
    expect(audio.headers.get('content-type')).toBe('audio/mpeg')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  })

  it('lists worlds', async () => {
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(200)
    const body = await response.json() as { directory: string; worlds: { id: string; name: string; coverVersion?: string }[] }
    expect(body.directory).toBe(join(base, 'worlds'))
    expect(body.worlds).toMatchObject([{ id: 'harbor', name: 'Harbor', tags: ['noir'] }])
    expect(body.worlds[0]?.coverVersion).toBeTruthy()
  })

  it('re-enumerates on POST refresh', async () => {
    await fetch(`${origin}/worlds`)
    const folder = join(base, 'worlds', 'later')
    await mkdir(folder)
    await writeFile(join(folder, 'world.json'), '{"id":"later","name":"Later"}')
    const cached = await (await fetch(`${origin}/worlds`)).json() as { worlds: unknown[] }
    expect(cached.worlds).toHaveLength(1)
    const refreshed = await (await fetch(`${origin}/worlds/refresh`, { method: 'POST' })).json() as { worlds: unknown[] }
    expect(refreshed.worlds).toHaveLength(2)
  })

  it('serves a cover with a long-lived cache only for its current version', async () => {
    const { worlds } = await (await fetch(`${origin}/worlds`)).json() as { worlds: { coverVersion: string }[] }
    const version = worlds[0]?.coverVersion ?? ''
    const current = await fetch(`${origin}/worlds/cover?id=harbor&v=${version}`)
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/png')
    expect(current.headers.get('cache-control')).toContain('immutable')
    expect(await current.text()).toBe('png-bytes')
    const stale = await fetch(`${origin}/worlds/cover?id=harbor&v=old`)
    expect(stale.headers.get('cache-control')).toBe('no-cache')
    await stale.arrayBuffer()
  })

  it('does not serve covers for unknown ids or paths', async () => {
    for (const id of ['missing', '../secret.png', '', 'harbor/../../secret.png']) {
      const response = await fetch(`${origin}/worlds/cover?id=${encodeURIComponent(id)}`)
      expect(response.status).toBe(404)
      await response.arrayBuffer()
    }
  })

  it('refuses unauthenticated requests', async () => {
    allowed = false
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(401)
    await response.arrayBuffer()
  })

  it('rejects unknown routes and wrong methods', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404)
    const wrong = await fetch(`${origin}/worlds`, { method: 'POST' })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET')
    expect((await fetch(`${origin}/worlds/refresh`)).status).toBe(405)
  })

  describe('the characters of a world', () => {
    it('lists them', async () => {
      const response = await fetch(`${origin}/worlds/characters?id=harbor`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(cast)
    })

    it('answers 404 for an unknown world', async () => {
      charactersError = new WorldNotFoundError('there is no world with id "nope"')
      expect((await fetch(`${origin}/worlds/characters?id=nope`)).status).toBe(404)
    })

    it('is refused without authentication', async () => {
      allowed = false
      expect((await fetch(`${origin}/worlds/characters?id=harbor`)).status).toBe(401)
    })
  })

  describe('listing sessions', () => {
    it('lists them', async () => {
      const response = await fetch(`${origin}/sessions`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(listed)
    })

    it('is refused without authentication', async () => {
      allowed = false
      expect((await fetch(`${origin}/sessions`)).status).toBe(401)
    })
  })

  describe('starting a session', () => {
    const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }): Promise<Response> =>
      fetch(`${origin}/sessions`, { method: 'POST', headers, body })
    const valid = '{"worldId":"harbor","playerCharacterId":"arthur"}'

    it('starts one for the world and character named in the body', async () => {
      const response = await post(valid)
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(started)
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur' })
    })

    it('passes on the name when one is given', async () => {
      await post('{"worldId":"harbor","playerCharacterId":"arthur","name":"Night one"}')
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur', name: 'Night one' })
    })

    it.each([
      ['a body without a world', '{"playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a blank world id', '{"worldId":"  ","playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a world id that is not text', '{"worldId":3,"playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a body without a character', '{"worldId":"harbor"}', 400, '"playerCharacterId" is required'],
      ['a name that is not text', '{"worldId":"harbor","playerCharacterId":"a","name":3}', 400, '"name" must be a string'],
      ['invalid JSON', '{', 400, 'not valid JSON'],
      ['a body that is not an object', '[]', 400, 'must be a JSON object'],
    ])('rejects %s', async (_label, body, status, message) => {
      const response = await post(body)
      expect(response.status).toBe(status)
      expect(((await response.json()) as { message: string }).message).toContain(message)
      expect(startedWith).toBeUndefined()
    })

    it('rejects a body that is not declared as JSON, or is too large', async () => {
      expect((await post(valid, { 'content-type': 'text/plain' })).status).toBe(415)
      expect((await post(JSON.stringify({ worldId: 'x'.repeat(20_000), playerCharacterId: 'a' }))).status).toBe(413)
      expect(startedWith).toBeUndefined()
    })

    it('answers 404 for an unknown world', async () => {
      startError = new WorldNotFoundError('there is no world with id "nope"')
      const response = await post(valid)
      expect(response.status).toBe(404)
      expect(((await response.json()) as { message: string }).message).toContain('no world')
    })

    it('answers 422 for a character or name that is not acceptable', async () => {
      startError = new InvalidStartError('Clara cannot be played')
      const response = await post(valid)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ message: 'Clara cannot be played' })
    })

    it('answers 422, with the problems, for a world that cannot be played', async () => {
      startError = new InvalidWorldError('the characters have 1 problem(s)', [{ path: '/w/c.json', message: 'name: is required' }])
      const response = await post(valid)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        message: 'the characters have 1 problem(s)',
        problems: [{ path: '/w/c.json', message: 'name: is required' }],
      })
    })

    it('answers 503 when the chat cannot be created for lack of services', async () => {
      startError = new AgentUnavailableError('this DSH profile has no session services')
      const response = await post(valid)
      expect(response.status).toBe(503)
      expect(((await response.json()) as { message: string }).message).toContain('no session services')
    })

    it('answers 500 for any other failure', async () => {
      startError = new Error('disk full')
      const response = await post(valid)
      expect(response.status).toBe(500)
      expect(((await response.json()) as { message: string }).message).toBe('disk full')
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await post(valid)).status).toBe(401)
      allowed = true
      const wrong = await fetch(`${origin}/sessions`, { method: 'PUT' })
      expect(wrong.status).toBe(405)
      expect(wrong.headers.get('allow')).toBe('GET, POST')
      expect(startedWith).toBeUndefined()
    })
  })

  describe('deleting a session', () => {
    const remove = (id: string): Promise<Response> => fetch(`${origin}/sessions/item?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

    it('deletes the session named in the query', async () => {
      const response = await remove('session-id')
      expect(response.status).toBe(204)
      expect(deleted).toBe('session-id')
    })

    it('answers 404 for a session that does not exist', async () => {
      deleteError = new SessionNotFoundError('no session "x"')
      const response = await remove('x')
      expect(response.status).toBe(404)
      expect(((await response.json()) as { message: string }).message).toBe('no session "x"')
    })

    it('answers 503 when the chat services are missing', async () => {
      deleteError = new AgentUnavailableError('no services')
      expect((await remove('session-id')).status).toBe(503)
    })

    it('answers 500 for any other failure', async () => {
      deleteError = new Error('locked')
      expect((await remove('session-id')).status).toBe(500)
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await remove('session-id')).status).toBe(401)
      allowed = true
      expect((await fetch(`${origin}/sessions/item?id=x`, { method: 'POST' })).status).toBe(405)
      expect(deleted).toBeUndefined()
    })
  })

  describe('opening a session', () => {
    const open = (id: string): Promise<Response> => fetch(`${origin}/sessions/open?id=${encodeURIComponent(id)}`, { method: 'POST' })

    it('answers with the chat to open', async () => {
      const response = await open('session-id')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'session-id', chatSessionId: 'session-session-id' })
      expect(opened).toBe('session-id')
    })

    it('answers 404 for an unknown session and 503 without chat services', async () => {
      openError = new SessionNotFoundError('no session "x"')
      expect((await open('x')).status).toBe(404)
      openError = new AgentUnavailableError('no services')
      expect((await open('x')).status).toBe(503)
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await open('session-id')).status).toBe(401)
      allowed = true
      expect((await fetch(`${origin}/sessions/open?id=x`)).status).toBe(405)
      expect(opened).toBeUndefined()
    })
  })

  describe('putting a session away', () => {
    it('is done and undone by POST, and answers 404 for an unknown session and 503 without the session services; an archived session cannot be opened', async () => {
      expect((await fetch(`${origin}/sessions/archive?id=abc`, { method: 'POST' })).status).toBe(204)
      expect((await fetch(`${origin}/sessions/restore?id=abc`, { method: 'POST' })).status).toBe(204)
      expect(archived).toEqual(['archive abc', 'restore abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/archive?id=x`, { method: 'POST' })).status).toBe(404)
      expect((await fetch(`${origin}/sessions/restore?id=x`, { method: 'POST' })).status).toBe(404)
      archiveError = new AgentUnavailableError('no session services')
      expect((await fetch(`${origin}/sessions/archive?id=x`, { method: 'POST' })).status).toBe(503)
      archiveError = undefined
      openError = new SessionArchivedError('the session is put away')
      const opened = await fetch(`${origin}/sessions/open?id=abc`, { method: 'POST' })
      expect(opened.status).toBe(409)
      expect(await opened.json()).toEqual({ message: 'the session is put away' })
      expect((await fetch(`${origin}/sessions/archive?id=abc`)).status).toBe(405)
    })
  })

  describe('the world of a session', () => {
    it('is read as the characters it has now, and a session there is not is 404', async () => {
      const found = await fetch(`${origin}/sessions/world?id=abc`)
      expect(found.status).toBe(200)
      expect(((await found.json()) as { characters: { key: string }[] }).characters.map(character => character.key)).toEqual(['abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/world?id=x`)).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/world?id=abc`, { method: 'POST' })).status).toBe(405)
    })
  })

  describe('editing a character', () => {
    const put = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('in a session: reads the edit, answers the world as it stands, 422 with the problems when it is not acceptable, 404 for an unknown session', async () => {
      const done = await put('/sessions/world/character?id=abc&key=clara', { name: 'Clara W', place: { location: 'bar', position: 'by the till' }, goals: [{ ref: '1', priority: 0.5 }] })
      expect(done.status).toBe(200)
      expect(edited).toEqual(['abc clara {"name":"Clara W","place":{"location":"bar","position":"by the till"},"goals":[{"ref":"1","priority":0.5}]}'])
      const refused = await put('/sessions/world/character?id=abc&key=clara', { name: '  ', role: 'wizard', unknown: 1 })
      expect(refused.status).toBe(422)
      expect(((await refused.json()) as { problems: string[] }).problems).toEqual(expect.arrayContaining(['name cannot be blank', 'role must be one of: playable, npc', 'unknown is not something that can be edited']))
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await put('/sessions/world/character?id=x&key=clara', { name: 'x' })).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/world/character?id=abc&key=clara`)).status).toBe(405)
    })

    it('in a world: is read and edited by the id of the world, 404 for a world there is not, 422 when the files would not be valid', async () => {
      expect(await (await fetch(`${origin}/worlds/state?id=harbor`)).json()).toEqual({ characters: [], places: [{ key: 'harbor', name: 'Bar', description: '', features: [] }], things: [], factions: [], relations: [] })
      expect((await put('/worlds/state/character?id=harbor&key=clara', { summary: 'Innkeeper' })).status).toBe(200)
      expect(edited).toEqual(['harbor clara {"summary":"Innkeeper"}'])
      editorError = new InvalidEditProblems(['there is no place "moon"'])
      const refused = await put('/worlds/state/character?id=harbor&key=clara', { summary: 'x' })
      expect(refused.status).toBe(422)
      expect(((await refused.json()) as { problems: string[] }).problems).toEqual(['there is no place "moon"'])
      editorError = new WorldNotFoundError('no world')
      expect((await fetch(`${origin}/worlds/state?id=nowhere`)).status).toBe(404)
    })
  })

  describe('naming a session', () => {
    const rename = (body: unknown, id = 'abc') => fetch(`${origin}/sessions/rename?id=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('is a POST with the name; a missing name is 400, a name that is not acceptable 422, an unknown session 404', async () => {
      expect((await rename({ name: 'Night 2' })).status).toBe(204)
      expect(archived).toEqual(['rename abc Night 2'])
      expect((await rename({})).status).toBe(400)
      archiveError = new InvalidStartError('the session needs a name')
      expect((await rename({ name: ' ' })).status).toBe(422)
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await rename({ name: 'x' }, 'x')).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/rename?id=abc`)).status).toBe(405)
    })
  })

  describe('the turns of a session', () => {
    const url = (path = '') => `${origin}/sessions/timeline${path}?id=abc`

    it('are told as they stand, and the story is taken to one of them or to the start, with what the player said offered back', async () => {
      const view = await fetch(url())
      expect(view.status).toBe(200)
      expect(await view.json()).toMatchObject({ head: 'n2', path: [{ id: 'n1', player: 'from abc' }] })
      const forward = await fetch(`${url('/move')}&to=n1`, { method: 'POST' })
      expect(forward.status).toBe(200)
      expect(await forward.json()).toEqual({})
      expect(moved).toEqual(['abc', 'n1'])
      expect(await (await fetch(`${url('/move')}&to=start`, { method: 'POST' })).json()).toEqual({ draft: 'the first message' })
    })

    it('answer 404 for an unknown session, 503 without the orchestration and 409 when the story cannot be taken there; need authentication and the right method', async () => {
      timelineError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      expect((await fetch(`${url('/move')}&to=n1`, { method: 'POST' })).status).toBe(404)
      timelineError = new AgentUnavailableError('no orchestration')
      expect((await fetch(url())).status).toBe(503)
      timelineError = new TimelineError('the state of the story at that turn was not kept')
      const refused = await fetch(`${url('/move')}&to=n1`, { method: 'POST' })
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ message: 'the state of the story at that turn was not kept' })
      timelineError = undefined
      expect((await fetch(`${url('/move')}&to=n1`)).status).toBe(405)
      allowed = false
      expect((await fetch(url())).status).toBe(401)
    })
  })

  describe('the notes of a session', () => {
    const url = () => `${origin}/sessions/notes?id=abc`

    it('are the lines the host made for the player after the last turn', async () => {
      const response = await fetch(url())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([{ kind: 'suggestions', turn: 2, lines: ['from abc'] }])
    })

    it('answer 404 for an unknown session, 401 without authentication and allow only GET', async () => {
      notesError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      notesError = undefined
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      expect((await fetch(url(), { method: 'POST' })).status).toBe(405)
    })
  })

  describe('scene images', () => {
    const url = () => `${origin}/sessions/images?id=abc&node=n2`

    it('reports status, starts generation and serves the immutable PNG', async () => {
      const status = await fetch(url())
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ node: 'n2', mode: 'manual', state: 'absent', images: [], message: 'abc' })
      const started = await fetch(url(), { method: 'POST' })
      expect(started.status).toBe(202)
      expect(await started.json()).toMatchObject({ node: 'n2', state: 'generating' })
      const image = await fetch(`${origin}/sessions/images/file?id=abc&node=n2&serial=1`)
      expect(image.status).toBe(200)
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(image.headers.get('cache-control')).toContain('immutable')
      expect(await image.text()).toBe('png-bytes')
    })

    it('requires authentication and the declared methods', async () => {
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      expect((await fetch(url(), { method: 'DELETE' })).status).toBe(405)
    })
  })

  describe('the settings of a session', () => {
    const url = (id = 'session-id') => `${origin}/sessions/settings?id=${encodeURIComponent(id)}`
    const put = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => fetch(url(), { method: 'PUT', headers, body })

    it('are read, with the bounds', async () => {
      const response = await fetch(url())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ settings: DEFAULT_SETTINGS, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0 })
    })

    it('are replaced by the body', async () => {
      const response = await put('{"maxRounds":6}')
      expect(response.status).toBe(200)
      expect(((await response.json()) as { settings: { maxRounds: number } }).settings.maxRounds).toBe(6)
      expect(writtenSettings).toEqual({ maxRounds: 6 })
    })

    it('answer 404 for an unknown session and 422, with the problems, for settings that are not acceptable', async () => {
      settingsError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      expect((await put('{"maxRounds":1}')).status).toBe(404)
      settingsError = new InvalidSettingsError(['"maxRounds" must be a whole number from 1 to 10'])
      const response = await put('{"maxRounds":99}')
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ message: expect.stringContaining('not acceptable'), problems: ['"maxRounds" must be a whole number from 1 to 10'] })
      expect((await fetch(url())).status).toBe(422)
    })

    it('reject a body that is not declared as JSON, are refused without authentication and allow no other method', async () => {
      expect((await put('{"maxRounds":2}', { 'content-type': 'text/plain' })).status).toBe(415)
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      const wrong = await fetch(url(), { method: 'POST' })
      expect(wrong.status).toBe(405)
      expect(wrong.headers.get('allow')).toBe('GET, PUT')
    })
  })
})
