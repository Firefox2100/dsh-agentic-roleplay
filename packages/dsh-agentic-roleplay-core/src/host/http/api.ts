import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { Note } from '../../shared/notes.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import type { OpenedSession, SessionsPayload, StartedSession, StartSessionRequest, WorldCharactersPayload } from '../../shared/sessions.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { InvalidSettingsError } from '../sessions/settings.ts'
import { AgentUnavailableError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
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
  sessions: {
    list(): SessionsPayload
    start(request: StartSessionRequest): Promise<StartedSession>
    open(id: string): Promise<OpenedSession>
    delete(id: string): Promise<void>
    readSettings(id: string): SettingsPayload
    writeSettings(id: string, value: unknown): SettingsPayload
    notes(id: string): Note[]
  }
  connection: ApiConnection
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** Build the request handler mounted at `/${API_PREFIX}`. */
export function createApiHandler({ worlds, worldCharacters, sessions, connection }: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const routes: Record<string, Partial<Record<string, Route>>> = {
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
    },
    '/worlds/refresh': {
      POST: async (_req, res) => { sendJson(res, 200, await worlds.list({ refresh: true })) },
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
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
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
