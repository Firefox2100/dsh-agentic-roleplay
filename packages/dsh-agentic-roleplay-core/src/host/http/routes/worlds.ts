import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { InvalidEditProblems } from '../../../shared/world-state.ts'
import { AgentUnavailableError, WorldNotFoundError } from '../../sessions/errors.ts'
import { WorldFolderExistsError } from '../../worlds/create-world.ts'
import { UnknownStarterError } from '../../worlds/starter.ts'
import { readJsonBody } from '../body.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { type Routes, languageField } from './shared.ts'

/** The routes of the API for worlds. */
export function worldsRoutes({ worlds, createWorld, starter, authorWorld, translation, worldCharacters, avatars }: ApiDeps): Routes {
  return {
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
      POST: async (req, res) => { try { const body = await readJsonBody(req) as { folder?: unknown; name?: unknown; preset?: unknown }; if (typeof body.folder !== 'string' || typeof body.name !== 'string') return sendError(res, 400, 'folder and name must be text'); if (body.preset !== undefined && typeof body.preset !== 'string') return sendError(res, 400, 'preset must be text'); sendJson(res, 201, await createWorld({ folder: body.folder, name: body.name, ...(body.preset === undefined ? {} : { preset: body.preset }) })) } catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); if (error instanceof WorldFolderExistsError) return sendError(res, 409, error.message); throw error } },
    },
    '/worlds/starter': {
      GET: async (_req, res) => { sendJson(res, 200, await starter.list()) },
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { folder?: unknown }
        if (typeof body.folder !== 'string') return sendError(res, 400, 'folder must be text')
        try { sendJson(res, 201, await starter.add(body.folder)) } catch (error) {
          if (error instanceof UnknownStarterError) return sendError(res, 404, error.message)
          if (error instanceof WorldFolderExistsError) return sendError(res, 409, error.message)
          throw error
        }
      },
    },
    '/worlds/refresh': {
      POST: async (_req, res) => { sendJson(res, 200, await worlds.list({ refresh: true })) },
    },
    '/worlds/authoring': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { title?: unknown; language?: unknown }
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await authorWorld(url.searchParams.get('id') ?? '', body.title.trim(), languageField(body.language))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/worlds/language': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, { language: await translation.language(url.searchParams.get('id') ?? '') ?? null }) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/translate': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { to?: unknown; title?: unknown; language?: unknown }
        if (body.to !== 'en' && body.to !== 'zh') return sendError(res, 400, 'to must be "en" or "zh"')
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await translation.start(url.searchParams.get('id') ?? '', body.to, body.title.trim(), languageField(body.language) ?? 'en')) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/avatars': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { name?: unknown }
        if (typeof body.name !== 'string' || body.name.trim() === '') return sendError(res, 400, 'name must be text')
        try { sendJson(res, 201, { key: await avatars.create(body.name) }) }
        catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
      DELETE: async (_req, res, url) => {
        try { await avatars.remove(url.searchParams.get('key') ?? ''); sendJson(res, 200, { deleted: true }) }
        catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/avatars': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { avatars?: unknown }
        if (!Array.isArray(body.avatars) || body.avatars.length === 0 || !body.avatars.every(key => typeof key === 'string')) return sendError(res, 400, 'avatars must be a list of keys')
        try { sendJson(res, 200, { added: await avatars.addToWorld(url.searchParams.get('id') ?? '', body.avatars as string[]) }) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
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
}
