import { TimelineError } from '../../timeline/service.ts'
import { InvalidSettingsError } from '../../sessions/settings.ts'
import { AgentUnavailableError, ReflectionRefusedError, SessionArchivedError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../../sessions/errors.ts'
import { readBinaryBody, readJsonBody } from '../body.ts'
import { sendError, sendJson } from '../respond.ts'
import { RcloneError, SyncRefusedError } from '../../sync/errors.ts'
import { failure as syncFailure } from '../../sync/routes.ts'
import type { ApiDeps } from '../api.ts'
import { MAX_UPLOAD_BYTES, Routes, imageUpdateOf, languageField, sendImage } from './shared.ts'

/** The routes of the API for sessions. */
export function sessionsRoutes({ sessions, externalTools, redundantLayers }: ApiDeps): Routes {
  return {
    '/sessions': {
      GET: async (_req, res) => { sendJson(res, 200, sessions.list()) },
      POST: async (req, res) => {
        const { worldId, playerCharacterId, playerAvatar, avatars: brought, name, settings, opening, startingTime, preset, lorebooks } = await readJsonBody(req)
        if (typeof worldId !== 'string' || worldId.trim() === '') return sendError(res, 400, '"worldId" is required')
        if (playerCharacterId === undefined && playerAvatar === undefined) return sendError(res, 400, '"playerCharacterId" or "playerAvatar" is required')
        if (playerCharacterId !== undefined && (typeof playerCharacterId !== 'string' || playerCharacterId.trim() === '')) return sendError(res, 400, '"playerCharacterId" must be text')
        if (playerAvatar !== undefined && (typeof playerAvatar !== 'string' || playerAvatar.trim() === '')) return sendError(res, 400, '"playerAvatar" must be text')
        if (brought !== undefined && (!Array.isArray(brought) || !brought.every(key => typeof key === 'string'))) return sendError(res, 400, '"avatars" must be a list of keys')
        if (name !== undefined && typeof name !== 'string') return sendError(res, 400, '"name" must be a string')
        if (opening !== undefined && (typeof opening !== 'number' || !Number.isInteger(opening))) return sendError(res, 400, '"opening" must be a whole number')
        if (startingTime !== undefined && typeof startingTime !== 'string') return sendError(res, 400, '"startingTime" must be text')
        if (preset !== undefined && typeof preset !== 'string') return sendError(res, 400, '"preset" must be text')
        if (lorebooks !== undefined && (!Array.isArray(lorebooks) || !lorebooks.every(entry => typeof entry === 'string'))) return sendError(res, 400, '"lorebooks" must be a list of lorebook names')
        try {
          sendJson(res, 201, await sessions.start({ ...(preset === undefined || preset === '' ? {} : { preset }), ...(lorebooks === undefined ? {} : { lorebooks: lorebooks as string[] }), ...(opening === undefined ? {} : { opening }), ...(startingTime === undefined ? {} : { startingTime }), worldId, ...(playerCharacterId === undefined ? {} : { playerCharacterId }), ...(playerAvatar === undefined ? {} : { playerAvatar }), ...(brought === undefined ? {} : { avatars: brought as string[] }), ...(name === undefined ? {} : { name }), ...(settings === undefined ? {} : { settings }) }))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidStartError) return sendError(res, 422, error.message)
          if (error instanceof InvalidWorldError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/message': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { id?: unknown; text?: unknown }
        if (typeof body.id !== 'string' || typeof body.text !== 'string' || body.text.trim() === '') return sendError(res, 400, 'id and text must be text, and the text must not be empty')
        try {
          await sessions.open(body.id)
          await sessions.send(body.id, body.text)
          sendJson(res, 202, { sent: true })
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof SessionArchivedError) return sendError(res, 409, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/open': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.open(url.searchParams.get('id') ?? '', url.searchParams.get('rebuild') === '1'))
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
    '/sessions/decisions': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.decisions(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
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
    '/sessions/gallery': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await sessions.gallery(url.searchParams.get('id') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
      PUT: async (req, res, url) => {
        const update = imageUpdateOf(await readJsonBody(req))
        if (typeof update === 'string') return sendError(res, 400, update)
        try { sendJson(res, 200, await sessions.updateImage(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '', update)) }
        catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/gallery/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'image'))
        try { sendJson(res, 201, { path: await sessions.uploadImage(url.searchParams.get('id') ?? '', name, await readBinaryBody(req, MAX_UPLOAD_BYTES)) }) }
        catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/gallery/file': {
      GET: async (_req, res, url) => {
        let image: { file: string; size: number }
        try { image = await sessions.galleryFile(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '') }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
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
    '/setup': {
      GET: async (_req, res) => { sendJson(res, 200, { redundantLayers: redundantLayers?.() ?? [] }) },
    },
    '/tools': {
      GET: async (_req, res) => { sendJson(res, 200, { tools: externalTools?.() ?? [] }) },
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
    '/sessions/activity/run': {
      GET: async (_req, res, url) => {
        try {
          const detail = sessions.activityRun(url.searchParams.get('id') ?? '', url.searchParams.get('run') ?? '')
          if (detail === undefined) return sendError(res, 404, 'this run was not kept, or has been dropped to make room')
          sendJson(res, 200, detail)
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof RangeError) return sendError(res, 400, error.message)
          throw error
        }
      },
    },
    '/sessions/doctor': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { title?: unknown; language?: unknown }
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await sessions.doctor(url.searchParams.get('id') ?? '', body.title.trim(), languageField(body.language) ?? 'en')) }
        catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/reflect': {
      POST: async (_req, res, url) => {
        try {
          await sessions.reflect(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof ReflectionRefusedError) return sendError(res, 409, error.message)
          throw error
        }
        res.statusCode = 202
        res.end()
      },
    },
    '/sessions/vectors/reset': {
      POST: async (_req, res, url) => {
        try {
          sessions.resetVectors(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
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
          await sessions.delete(url.searchParams.get('id') ?? '', url.searchParams.get('everywhere') === 'true')
        } catch (error) {
          if (error instanceof SyncRefusedError || error instanceof RcloneError) return syncFailure(res, error)
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
  }
}
