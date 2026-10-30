import { WorldNotFoundError } from '../../sessions/errors.ts'
import { readBinaryBody, readJsonBody } from '../body.ts'
import { parseChoices } from '../../import/store.ts'
import { parseSelectionChoice } from '../../import/staging.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { type Routes, importFailure, languageField, sendImage, updateField } from './shared.ts'

/** The routes of the API for imports. */
export function importsRoutes({ importer }: ApiDeps): Routes {
  return {
    '/worlds/import/card': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'card'))
        try { sendJson(res, 200, await importer.upload(await readBinaryBody(req, importer.maxUploadBytes), name)) }
        catch (error) { return importFailure(res, error) }
      },
    },
    '/worlds/import/update': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await importer.updateStatus(url.searchParams.get('id') ?? '')) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
      DELETE: async (_req, res, url) => {
        try { sendJson(res, 200, await importer.revertUpdate(url.searchParams.get('id') ?? '')) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/worlds/import/preset': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'preset'))
        try { sendJson(res, 200, await importer.uploadPreset(url.searchParams.get('id') ?? '', await readBinaryBody(req, importer.maxUploadBytes), name, languageField(url.searchParams.get('language') ?? undefined))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/import/stage': {
      POST: async (req, res, url) => {
        const kind = url.searchParams.get('kind')
        if (kind !== 'preset' && kind !== 'lorebook') return sendError(res, 400, '"kind" must be preset or lorebook')
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? kind))
        try { sendJson(res, 200, importer.stage(kind, await readBinaryBody(req, importer.maxUploadBytes), name)) }
        catch (error) { return importFailure(res, error) }
      },
      DELETE: async (_req, res, url) => { importer.discardStaged(url.searchParams.get('id') ?? ''); res.statusCode = 204; res.end() },
    },
    '/worlds/import/preset/verbatim': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { worldId } = body as Record<string, unknown>
        if (typeof worldId !== 'string') return sendError(res, 400, '"worldId" must be text')
        try { sendJson(res, 200, await importer.applyStagedVerbatim(worldId, choice)) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/worlds/import/preset/staged': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { worldId, language } = body as Record<string, unknown>
        if (typeof worldId !== 'string') return sendError(res, 400, '"worldId" must be text')
        try { sendJson(res, 200, await importer.uploadStaged(worldId, choice, languageField(language))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/worlds/import': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await importer.read(url.searchParams.get('id') ?? '')) } catch (error) { return importFailure(res, error) } },
      DELETE: async (_req, res, url) => { try { await importer.discard(url.searchParams.get('id') ?? ''); res.statusCode = 204; res.end() } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/choices': {
      PUT: async (req, res, url) => { try { sendJson(res, 200, await importer.choose(url.searchParams.get('id') ?? '', parseChoices(await readJsonBody(req)))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/start': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req); sendJson(res, 200, await importer.start(url.searchParams.get('id') ?? '', parseChoices(body), languageField((body as { language?: unknown }).language), updateField(body))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/structure': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req); sendJson(res, 200, await importer.importStructure(url.searchParams.get('id') ?? '', parseChoices(body), languageField((body as { language?: unknown }).language))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/draft': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await importer.draftStatus(url.searchParams.get('id') ?? '')) } catch (error) { return importFailure(res, error) } },
      POST: async (req, res, url) => {
        try {
          const body = await readJsonBody(req) as { action?: unknown; language?: unknown }
          if (body.action !== 'ask' && body.action !== 'keep' && body.action !== 'discard') return sendError(res, 400, '"action" must be ask, keep or discard')
          sendJson(res, 200, await importer.actOnDraft(url.searchParams.get('id') ?? '', body.action, languageField(body.language)))
        } catch (error) { return importFailure(res, error) }
      },
    },
    '/worlds/import/resume': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req); sendJson(res, 200, await importer.resume(url.searchParams.get('id') ?? '', languageField((body as { language?: unknown }).language))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/picture': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await importer.picture(url.searchParams.get('id') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
  }
}
