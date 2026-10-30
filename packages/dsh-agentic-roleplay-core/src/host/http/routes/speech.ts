import type { SpeechPart } from '../../speech/service.ts'
import { readJsonBody } from '../body.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import type { Routes } from './shared.ts'

/** The routes of the API for speech. */
export function speechRoutes({ speech }: ApiDeps): Routes {
  return {
    '/speech/capabilities': { GET: async (_req, res) => { sendJson(res, 200, { streaming: speech.streaming() }) } },
    '/speech/voices': { GET: async (_req, res) => { sendJson(res, 200, await speech.voices()) } },
    '/speech/synthesize': { POST: async (req, res) => { const body = await readJsonBody(req) as { parts?: unknown }; if (!Array.isArray(body.parts)) return sendError(res, 400, 'parts must be a list'); const parts = body.parts.filter((part): part is SpeechPart => typeof part === 'object' && part !== null && typeof (part as SpeechPart).text === 'string'); if (parts.length !== body.parts.length) return sendError(res, 400, 'each speech part needs text'); const audio = await speech.speak(parts); res.statusCode = 200; res.setHeader('content-type', audio.mediaType); res.setHeader('content-length', audio.bytes.length); res.end(audio.bytes) } },
  }
}
