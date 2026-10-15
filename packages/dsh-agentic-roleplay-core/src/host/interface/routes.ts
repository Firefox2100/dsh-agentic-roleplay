import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { HistoryTurn, InterfaceAvailability, InterfacePayload, InterfaceStatus, InterfaceSync, PackPreview, PlayerViewReply, WorldPackDetail } from '../../shared/interface-pack.ts'
import { readJsonBody } from '../http/body.ts'
import { sendError, sendJson } from '../http/respond.ts'
import { SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { InvalidPacksError } from './service.ts'
import { PACK_HEADERS } from './frame.ts'
import type { PackResponse } from './service.ts'

/** What the routes need of the interface service. */
export interface InterfaceApi {
  describe(id: string): InterfacePayload
  view(id: string, revision?: string): PlayerViewReply
  history(id: string, limit?: number): HistoryTurn[]
  file(id: string, path: string): PackResponse | undefined
  sessionOfFrame(key: string): string | undefined
  storage(id: string, request: { op: 'get' | 'set' | 'remove'; key: string; value?: unknown }): unknown
  availability(): InterfaceAvailability
  status(id: string): Promise<InterfaceStatus>
  sync(id: string): Promise<InterfaceSync>
  worldPacks(worldId: string): Promise<WorldPackDetail[]>
  preview(worldId: string, pack: string): Promise<PackPreview>
}

export type InterfaceRoute = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** The address under which the files of a session's pack are served to the page: `<prefix>/<session id>/<path of the file>`. */
export const PACK_FILES = '/sessions/interface/pack/'

/**
 * The address under which a surface loads its own files: `<prefix>/<key>/<path of the file>`. A sandboxed frame has no
 * origin and so no cookie, so these are served without a login; the key is long, random and belongs to one story.
 */
export const FRAME_FILES = '/sessions/interface/frame/'

const notFound = (res: ServerResponse, error: unknown): void => {
  if (error instanceof SessionNotFoundError || error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
  throw error
}

function storageRequest(body: unknown): { op: 'get' | 'set' | 'remove'; key: string; value?: unknown } | string {
  if (typeof body !== 'object' || body === null) return 'the request must be an object'
  const { op, key, value } = body as Record<string, unknown>
  if (op !== 'get' && op !== 'set' && op !== 'remove') return 'op must be get, set or remove'
  if (typeof key !== 'string' || key === '') return 'key must be text'
  return { op, key, ...(value === undefined ? {} : { value }) }
}

export function interfaceRoutes(api: InterfaceApi): Record<string, Partial<Record<string, InterfaceRoute>>> {
  return {
    '/sessions/interface': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, api.describe(url.searchParams.get('id') ?? '')) } catch (error) { notFound(res, error) }
      },
    },
    '/sessions/interface/view': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, api.view(url.searchParams.get('id') ?? '', url.searchParams.get('revision') ?? undefined)) } catch (error) { notFound(res, error) }
      },
    },
    '/sessions/interface/history': {
      GET: async (_req, res, url) => {
        const asked = Number(url.searchParams.get('limit'))
        try { sendJson(res, 200, api.history(url.searchParams.get('id') ?? '', Number.isInteger(asked) && asked > 0 ? asked : undefined)) } catch (error) { notFound(res, error) }
      },
    },
    '/sessions/interface/storage': {
      POST: async (req, res, url) => {
        const request = storageRequest(await readJsonBody(req))
        if (typeof request === 'string') return sendError(res, 400, request)
        try { sendJson(res, 200, { value: api.storage(url.searchParams.get('id') ?? '', request) }) } catch (error) {
          if (error instanceof RangeError) return sendError(res, 422, error.message)
          notFound(res, error)
        }
      },
    },
    '/sessions/interface/status': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await api.status(url.searchParams.get('id') ?? '')) } catch (error) { notFound(res, error) }
      },
    },
    '/sessions/interface/sync': {
      POST: async (_req, res, url) => {
        try { sendJson(res, 200, await api.sync(url.searchParams.get('id') ?? '')) } catch (error) {
          if (error instanceof InvalidPacksError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          notFound(res, error)
        }
      },
    },
    '/worlds/interface': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await api.worldPacks(url.searchParams.get('id') ?? '')) } catch (error) { notFound(res, error) }
      },
    },
    '/worlds/interface/preview': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await api.preview(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '')) } catch (error) {
          if (error instanceof InvalidPacksError) return sendJson(res, 422, { message: error.message, problems: error.problems.map(problem => `${problem.path === '' ? '' : `${problem.path}: `}${problem.message}`) })
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          notFound(res, error)
        }
      },
    },
    '/interface/availability': {
      GET: async (_req, res) => { sendJson(res, 200, api.availability()) },
    },
  }
}

/** Serves one file of a session's pack, for a path like `/sessions/interface/pack/<id>/<file>` or `/sessions/interface/frame/<key>/<file>`. */
export async function sendPackFile(api: InterfaceApi, path: string, res: ServerResponse): Promise<void> {
  const framed = path.startsWith(FRAME_FILES)
  const rest = path.slice((framed ? FRAME_FILES : PACK_FILES).length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return sendError(res, 404, 'not found')
  const session = framed ? api.sessionOfFrame(rest.slice(0, slash)) : rest.slice(0, slash)
  if (session === undefined) return sendError(res, 404, 'not found')
  let file: PackResponse | undefined
  try {
    file = api.file(session, rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/'))
  } catch (error) {
    if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
    if (error instanceof URIError) return sendError(res, 400, 'the path is not valid')
    throw error
  }
  if (file === undefined) return sendError(res, 404, 'the pack has no such file')
  res.statusCode = 200
  for (const [name, value] of Object.entries(PACK_HEADERS)) res.setHeader(name, value)
  res.setHeader('content-type', file.mediaType)
  // A frame has no origin, so its own fetches of the pack's files are cross-origin and need to be allowed to read them.
  if (framed) res.setHeader('access-control-allow-origin', '*')
  if (file.kind === 'page') {
    const body = Buffer.from(file.body)
    res.setHeader('content-length', body.length)
    res.end(body)
    return
  }
  res.setHeader('content-length', file.size)
  await pipeline(createReadStream(file.file), res)
}
