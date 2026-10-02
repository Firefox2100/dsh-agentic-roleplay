import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { API_PREFIX } from '../../shared/worlds.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { sendError, sendJson } from './respond.ts'

/** The slice of DSH's connection service this API relies on for browser authentication. */
export interface ApiConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

export interface ApiDeps {
  worlds: WorldCatalog
  connection: ApiConnection
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** Build the request handler mounted at `/${API_PREFIX}`. */
export function createApiHandler({ worlds, connection }: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const routes: Record<string, Partial<Record<string, Route>>> = {
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
    },
    '/worlds/refresh': {
      POST: async (_req, res) => { sendJson(res, 200, await worlds.list({ refresh: true })) },
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
      else sendError(res, 500, error instanceof Error ? error.message : 'internal error')
    }
  }
}
