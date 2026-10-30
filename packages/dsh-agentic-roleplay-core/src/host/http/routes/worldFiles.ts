import { parseDiceEdit } from '../../../shared/world-dice.ts'
import { parseCalendarEdit, parseRoutineEdit, parseVariablesEdit } from '../../../shared/world-daily.ts'
import { InvalidEditProblems, parseCharacterEdit, parseFactionEdit, parseLoreEdit, parsePlaceEdit, parseRelationEdit, parseThingEdit, type PlotsEdit } from '../../../shared/world-state.ts'
import { parseWorldInfoEdit } from '../../../shared/world-info.ts'
import { SessionNotFoundError, WorldNotFoundError } from '../../sessions/errors.ts'
import { readBinaryBody, readJsonBody } from '../body.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { MAX_UPLOAD_BYTES, Routes, imageUpdateOf, sendImage } from './shared.ts'

/** The routes of the API for worldFiles. */
export function worldFilesRoutes({ worldFiles, worldEditor, sessions }: ApiDeps): Routes {
  return {
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
    '/worlds/state/lore': {
      POST: async (req, res, url) => {
        try {
          const body = await readJsonBody(req) as { title?: unknown } | null
          if (typeof body?.title !== 'string') throw new InvalidEditProblems(['the entry needs a title'])
          sendJson(res, 200, await worldEditor.addLore(url.searchParams.get('id') ?? '', body.title))
        } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.removeLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseLoreEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/interface/file': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, { text: await worldEditor.readPackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { text?: unknown } | null; if (typeof body?.text !== 'string') throw new InvalidEditProblems(['text must be text']); sendJson(res, 200, { problems: await worldEditor.writePackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '', body.text) }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, { problems: await worldEditor.deletePackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); return sendError(res, 422, error instanceof Error ? error.message : String(error)) } },
    },
    '/worlds/interface/pack': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req) as { name?: unknown } | null; sendJson(res, 201, { problems: await worldEditor.createPack(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', typeof body?.name === 'string' ? body.name : '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
    },
    '/worlds/state/trigger': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.readTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.writeTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readJsonBody(req))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.removeTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
    },
    '/worlds/state/plots': { PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { plots?: unknown }; if (!Array.isArray(body.plots)) return sendError(res, 400, 'plots must be a list'); sendJson(res, 200, await worldEditor.editPlots(url.searchParams.get('id') ?? '', { plots: body.plots as PlotsEdit['plots'] })) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/state/relation': { PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editRelation(url.searchParams.get('id') ?? '', parseRelationEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/routines': { GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.routines(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } } },
    '/worlds/routines/item': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editRoutine(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseRoutineEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/dice': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.dice(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editDice(url.searchParams.get('id') ?? '', parseDiceEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/calendar': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.calendar(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editCalendar(url.searchParams.get('id') ?? '', parseCalendarEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/variables': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.variables(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editVariables(url.searchParams.get('id') ?? '', parseVariablesEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/info': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.info(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editInfo(url.searchParams.get('id') ?? '', parseWorldInfoEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/prompts': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.prompts(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
    },
    '/worlds/prompts/item': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.readPrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? '')) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) } },
      PUT: async (req, res, url) => {
        const body = await readJsonBody(req)
        if (typeof body['text'] !== 'string') return sendError(res, 400, 'text must be text')
        try { await worldFiles.writePrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? '', body['text']); sendJson(res, 200, {}) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) }
      },
      DELETE: async (_req, res, url) => { try { await worldFiles.deletePrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? ''); sendJson(res, 200, {}) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) } },
    },
    '/worlds/gallery': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.gallery(url.searchParams.get('id') ?? '')) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 409, error instanceof Error ? error.message : String(error)) } },
      PUT: async (req, res, url) => {
        const update = imageUpdateOf(await readJsonBody(req))
        if (typeof update === 'string') return sendError(res, 400, update)
        try { sendJson(res, 200, await worldFiles.updateImage(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '', update)) } catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/gallery/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'image'))
        try { sendJson(res, 201, { path: await worldFiles.uploadImage(url.searchParams.get('id') ?? '', name, await readBinaryBody(req, MAX_UPLOAD_BYTES)) }) } catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/gallery/file': {
      GET: async (_req, res, url) => {
        let image: { file: string; size: number }
        try { image = await worldFiles.galleryFile(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '') } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
      },
    },
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
    '/worlds/state/character/portrait/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'portrait.png'))
        try { sendJson(res, 200, await worldEditor.uploadPortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/state/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await worldEditor.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    ...Object.fromEntries((['place', 'thing'] as const).flatMap(kind => [
      [`/worlds/state/${kind}/image`, {
        POST: async (_req, res, url) => {
          try { sendJson(res, 200, await worldEditor.generateEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) {
            if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            return sendError(res, 409, error instanceof Error ? error.message : String(error))
          }
        },
      }],
      [`/worlds/state/${kind}/image/upload`, {
        POST: async (req, res, url) => {
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'image.png'))
          try { sendJson(res, 200, await worldEditor.uploadEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
            if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            throw error
          }
        },
      }],
      [`/worlds/state/${kind}/image/file`, {
        GET: async (_req, res, url) => {
          try { await sendImage(res, await worldEditor.entityImageFile(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        },
      }],
      [`/sessions/world/${kind}/image`, {
        POST: async (_req, res, url) => {
          try { sendJson(res, 200, await sessions.generateEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) {
            if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            return sendError(res, 409, error instanceof Error ? error.message : String(error))
          }
        },
      }],
      [`/sessions/world/${kind}/image/upload`, {
        POST: async (req, res, url) => {
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'image.png'))
          try { sendJson(res, 200, await sessions.uploadEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
            if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            throw error
          }
        },
      }],
      [`/sessions/world/${kind}/image/file`, {
        GET: async (_req, res, url) => {
          try { await sendImage(res, await sessions.entityImageFile(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        },
      }],
    ])),
  }
}
