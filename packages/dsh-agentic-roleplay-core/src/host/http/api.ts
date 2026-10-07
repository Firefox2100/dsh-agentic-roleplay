import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { Note } from '../../shared/notes.ts'
import type { SceneImageStatus } from '../../shared/images.ts'
import { InvalidEditProblems, parseCharacterEdit, parseFactionEdit, parsePlaceEdit, parseRelationEdit, parseThingEdit, type CharacterEdit, type FactionEdit, type PlaceEdit, type RelationChange, type ThingEdit, type WorldState } from '../../shared/world-state.ts'
import type { TimelineView } from '../../shared/timeline.ts'
import type { SpeechAudio, SpeechPart } from '../speech/service.ts'
import type { TtsVoice } from 'dsh-ai-core'
import { TimelineError } from '../timeline/service.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import type { OpenedSession, SessionsPayload, StartedSession, StartSessionRequest, WorldCharactersPayload } from '../../shared/sessions.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { InvalidSettingsError } from '../sessions/settings.ts'
import { AgentUnavailableError, SessionArchivedError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { readJsonBody } from './body.ts'
import { HttpError, sendError, sendJson } from './respond.ts'

/** The slice of DSH's connection service this API relies on for browser authentication. */
export interface ApiConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

export interface ApiDeps {
  worlds: WorldCatalog
  worldCharacters(worldId: string): Promise<WorldCharactersPayload>
  /** The characters and places of a world's files, as the editor shows them. */
  worldEditor: {
    read(worldId: string): Promise<WorldState>
    editCharacter(worldId: string, key: string, edit: CharacterEdit): Promise<WorldState>
    editPlace(worldId: string, key: string, edit: PlaceEdit): Promise<WorldState>
    editThing(worldId: string, key: string, edit: ThingEdit): Promise<WorldState>
    editFaction(worldId: string, key: string, edit: FactionEdit): Promise<WorldState>
    editRelation(worldId: string, edit: RelationChange): Promise<WorldState>
    editNarrationVoice(worldId: string, voice: string): Promise<WorldState>
    generatePortrait(worldId: string, key: string): Promise<WorldState>
    portraitFile(worldId: string, key: string): Promise<{ file: string; size: number }>
  }
  sessions: {
    list(): SessionsPayload
    start(request: StartSessionRequest): Promise<StartedSession>
    open(id: string): Promise<OpenedSession>
    delete(id: string): Promise<void>
    archive(id: string): Promise<void>
    restore(id: string): Promise<void>
    rename(id: string, name: string): Promise<void>
    world(id: string): WorldState
    editCharacter(id: string, key: string, edit: CharacterEdit): WorldState
    editPlace(id: string, key: string, edit: PlaceEdit): WorldState
    editThing(id: string, key: string, edit: ThingEdit): WorldState
    editFaction(id: string, key: string, edit: FactionEdit): WorldState
    editRelation(id: string, edit: RelationChange): WorldState
    editNarrationVoice(id: string, voice: string): WorldState
    generatePortrait(id: string, key: string): Promise<WorldState>
    portraitFile(id: string, key: string): Promise<{ file: string; size: number }>
    readSettings(id: string): SettingsPayload
    writeSettings(id: string, value: unknown): SettingsPayload
    notes(id: string): Note[]
    timeline(id: string): TimelineView
    moveTimeline(id: string, to: string): Promise<{ draft?: string }>
    imageStatus(id: string, node: string): Promise<SceneImageStatus>
    generateImage(id: string, node: string): Promise<SceneImageStatus>
    imageFile(id: string, node: string, serial: number): Promise<{ file: string; size: number }>
  }
  connection: ApiConnection
  speech: { voices(): Promise<TtsVoice[]>; speak(parts: SpeechPart[]): Promise<SpeechAudio>; streaming(): boolean }
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

async function sendImage(res: ServerResponse, image: { file: string; size: number }): Promise<void> {
  res.statusCode = 200
  res.setHeader('content-type', 'image/png')
  res.setHeader('content-length', image.size)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  await pipeline(createReadStream(image.file), res)
}

/** Build the request handler mounted at `/${API_PREFIX}`. */
export function createApiHandler({ worlds, worldCharacters, worldEditor, sessions, connection, speech }: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const routes: Record<string, Partial<Record<string, Route>>> = {
    '/speech/capabilities': { GET: async (_req, res) => { sendJson(res, 200, { streaming: speech.streaming() }) } },
    '/speech/voices': { GET: async (_req, res) => { sendJson(res, 200, await speech.voices()) } },
    '/speech/synthesize': { POST: async (req, res) => { const body = await readJsonBody(req) as { parts?: unknown }; if (!Array.isArray(body.parts)) return sendError(res, 400, 'parts must be a list'); const parts = body.parts.filter((part): part is SpeechPart => typeof part === 'object' && part !== null && typeof (part as SpeechPart).text === 'string'); if (parts.length !== body.parts.length) return sendError(res, 400, 'each speech part needs text'); const audio = await speech.speak(parts); res.statusCode = 200; res.setHeader('content-type', audio.mediaType); res.setHeader('content-length', audio.bytes.length); res.end(audio.bytes) } },
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
    },
    '/worlds/refresh': {
      POST: async (_req, res) => { sendJson(res, 200, await worlds.list({ refresh: true })) },
    },
    '/worlds/state': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.read(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/state/character': {
      PUT: async (req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.editCharacter(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseCharacterEdit(await readJsonBody(req))))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/state/place': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldEditor.editPlace(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parsePlaceEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/state/thing': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldEditor.editThing(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseThingEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/state/faction': { PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editFaction(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseFactionEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/state/relation': { PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editRelation(url.searchParams.get('id') ?? '', parseRelationEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/state/narration-voice': { PUT: async (req, res, url) => { const body = await readJsonBody(req) as { voice?: unknown }; if (typeof body.voice !== 'string') return sendError(res, 400, 'voice must be text'); sendJson(res, 200, await worldEditor.editNarrationVoice(url.searchParams.get('id') ?? '', body.voice)) } },
    '/worlds/state/character/portrait': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.generatePortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          return sendError(res, 409, error instanceof Error ? error.message : String(error))
        }
      },
    },
    '/worlds/state/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await worldEditor.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/characters': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldCharacters(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions': {
      GET: async (_req, res) => { sendJson(res, 200, sessions.list()) },
      POST: async (req, res) => {
        const { worldId, playerCharacterId, name, settings } = await readJsonBody(req)
        if (typeof worldId !== 'string' || worldId.trim() === '') return sendError(res, 400, '"worldId" is required')
        if (typeof playerCharacterId !== 'string' || playerCharacterId.trim() === '') return sendError(res, 400, '"playerCharacterId" is required')
        if (name !== undefined && typeof name !== 'string') return sendError(res, 400, '"name" must be a string')
        try {
          sendJson(res, 201, await sessions.start({ worldId, playerCharacterId, ...(name === undefined ? {} : { name }), ...(settings === undefined ? {} : { settings }) }))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidStartError) return sendError(res, 422, error.message)
          if (error instanceof InvalidWorldError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/open': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.open(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof SessionArchivedError) return sendError(res, 409, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/timeline': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.timeline(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/timeline/move': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.moveTimeline(url.searchParams.get('id') ?? '', url.searchParams.get('to') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          if (error instanceof TimelineError) return sendError(res, 409, error.message)
          throw error
        }
      },
    },
    '/sessions/notes': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.notes(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions/images': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await sessions.imageStatus(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
      POST: async (_req, res, url) => {
        try { sendJson(res, 202, await sessions.generateImage(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/images/file': {
      GET: async (_req, res, url) => {
        const serial = Number(url.searchParams.get('serial'))
        let image: { file: string; size: number }
        try { image = await sessions.imageFile(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '', serial) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
      },
    },
    '/sessions/settings': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.readSettings(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidSettingsError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
      PUT: async (req, res, url) => {
        const body = await readJsonBody(req)
        try {
          sendJson(res, 200, sessions.writeSettings(url.searchParams.get('id') ?? '', body))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidSettingsError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/archive': {
      POST: async (_req, res, url) => {
        try {
          await sessions.archive(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/restore': {
      POST: async (_req, res, url) => {
        try {
          await sessions.restore(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/world': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.world(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions/world/character': {
      PUT: async (req, res, url) => {
        try {
          sendJson(res, 200, sessions.editCharacter(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseCharacterEdit(await readJsonBody(req))))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/world/place': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, sessions.editPlace(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parsePlaceEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/sessions/world/thing': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, sessions.editThing(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseThingEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/sessions/world/faction': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editFaction(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseFactionEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/relation': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editRelation(url.searchParams.get('id') ?? '', parseRelationEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/narration-voice': { PUT: async (req, res, url) => { const body = await readJsonBody(req) as { voice?: unknown }; if (typeof body.voice !== 'string') return sendError(res, 400, 'voice must be text'); sendJson(res, 200, sessions.editNarrationVoice(url.searchParams.get('id') ?? '', body.voice)) } },
    '/sessions/world/character/portrait': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.generatePortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          return sendError(res, 409, error instanceof Error ? error.message : String(error))
        }
      },
    },
    '/sessions/world/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await sessions.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/rename': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req)
        const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined
        if (typeof name !== 'string') return sendError(res, 400, 'the request needs a "name"')
        try {
          await sessions.rename(url.searchParams.get('id') ?? '', name)
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidStartError) return sendError(res, 422, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/item': {
      DELETE: async (_req, res, url) => {
        try {
          await sessions.delete(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/worlds/cover': {
      GET: async (_req, res, url) => {
        const cover = await worlds.cover(url.searchParams.get('id') ?? '')
        if (cover === undefined) return sendError(res, 404, 'no cover')
        res.statusCode = 200
        res.setHeader('content-type', cover.contentType)
        res.setHeader('content-length', cover.size)
        res.setHeader('x-content-type-options', 'nosniff')
        // The version in the URL changes with the file, so a matching one can be kept indefinitely.
        res.setHeader(
          'cache-control',
          cover.version === url.searchParams.get('v') ? 'private, max-age=31536000, immutable' : 'no-cache',
        )
        await pipeline(createReadStream(cover.file), res)
      },
    },
  }


  return async (req, res) => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(`/${API_PREFIX}`.length) || '/'
    const methods = routes[path]
    if (methods === undefined) return sendError(res, 404, 'not found')
    const route = methods[req.method ?? '']
    if (route === undefined) {
      res.setHeader('allow', Object.keys(methods).join(', '))
      return sendError(res, 405, 'method not allowed')
    }
    try {
      await route(req, res, url)
    } catch (error) {
      if (res.headersSent) res.destroy()
      else if (error instanceof HttpError) sendError(res, error.status, error.message)
      else sendError(res, 500, error instanceof Error ? error.message : 'internal error')
    }
  }
}
