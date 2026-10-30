import { InvalidEditProblems, parseCharacterEdit, parseFactionEdit, parseLoreEdit, parsePlaceEdit, parseRelationEdit, parseThingEdit, type PlotsEdit } from '../../../shared/world-state.ts'
import { SessionNotFoundError } from '../../sessions/errors.ts'
import { readBinaryBody, readJsonBody } from '../body.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { MAX_UPLOAD_BYTES, Routes, sendImage } from './shared.ts'

/** The routes of the API for sessionWorld. */
export function sessionWorldRoutes({ sessions }: ApiDeps): Routes {
  return {
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
    '/sessions/world/lore': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseLoreEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/plots': { PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { plots?: unknown }; if (!Array.isArray(body.plots)) return sendError(res, 400, 'plots must be a list'); sendJson(res, 200, sessions.editPlots(url.searchParams.get('id') ?? '', { plots: body.plots as PlotsEdit['plots'] })) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
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
    '/sessions/world/character/portrait/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'portrait.png'))
        try { sendJson(res, 200, await sessions.uploadPortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/world/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await sessions.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
  }
}
