import { CatalogueError } from '../../catalogue/errors.ts'
import { readJsonBody } from '../body.ts'
import { parseChoices } from '../../import/store.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { type Routes, catalogueFailure, importFailure, languageField, updateField } from './shared.ts'

/** The routes of the API for catalogue. */
export function catalogueRoutes({ catalogue }: ApiDeps): Routes {
  return {
    '/catalogue/sources': { GET: async (_req, res) => { try { sendJson(res, 200, await catalogue.sources()) } catch (error) { return catalogueFailure(res, error) } } },
    '/catalogue/key': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.describeKey(url.searchParams.get('ref') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
      PUT: async (req, res) => {
        const { ref, value } = await readJsonBody(req)
        if (typeof ref !== 'string' || typeof value !== 'string') return sendError(res, 400, '"ref" and "value" must be text')
        try { sendJson(res, 200, await catalogue.keepKey(ref, value)) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/worlds': {
      GET: async (_req, res, url) => {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'recent'
        try { sendJson(res, 200, await catalogue.worlds(url.searchParams.get('source') ?? '', { kind: (['card', 'preset', 'lorebook'] as const).find(entry => entry === url.searchParams.get('kind')) ?? 'world', search: url.searchParams.get('search') ?? '', offset: Number.isFinite(offset) ? offset : 0, sort })) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/world': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.world(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
    },
    '/catalogue/cover': {
      GET: async (_req, res, url) => {
        try {
          const cover = await catalogue.cover(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '')
          res.statusCode = 200
          res.setHeader('content-type', cover.type)
          res.setHeader('content-length', cover.body.length)
          res.setHeader('x-content-type-options', 'nosniff')
          res.setHeader('cache-control', 'private, no-cache')
          res.end(cover.body)
        } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/updates': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.updates(url.searchParams.get('source') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
    },
    '/catalogue/install': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { url?: unknown; sha256?: unknown; mode?: unknown; overwriteChanges?: unknown }
        if (typeof body.url !== 'string') return sendError(res, 400, 'url must be text')
        if (body.sha256 !== undefined && typeof body.sha256 !== 'string') return sendError(res, 400, 'sha256 must be text')
        if (body.mode !== undefined && body.mode !== 'new' && body.mode !== 'update' && body.mode !== 'copy') return sendError(res, 400, 'mode must be new, update or copy')
        if (body.overwriteChanges !== undefined && typeof body.overwriteChanges !== 'boolean') return sendError(res, 400, 'overwriteChanges must be true or false')
        try { sendJson(res, 201, await catalogue.install({ url: body.url, ...(body.sha256 === undefined ? {} : { sha256: body.sha256 }), ...(body.mode === undefined ? {} : { mode: body.mode }), ...(body.overwriteChanges === undefined ? {} : { overwriteChanges: body.overwriteChanges }) })) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/convert': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convert({ source: body.source, versionId: body.versionId, ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/stage/card': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        try { sendJson(res, 200, await catalogue.stageCard({ source: body.source, versionId: body.versionId })) }
        catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/staged': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; id?: unknown; choices?: unknown; language?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string' || typeof body.id !== 'string') return sendError(res, 400, 'source, versionId and id must be text')
        try {
          const language = languageField(body.language)
          const update = updateField(body)
          sendJson(res, 201, await catalogue.convertStaged({ source: body.source, versionId: body.versionId, id: body.id, choices: parseChoices(body.choices), ...(update === undefined ? {} : { update }), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/preset': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown; title?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.title !== undefined && typeof body.title !== 'string') return sendError(res, 400, 'title must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convertPreset({ source: body.source, versionId: body.versionId, ...(body.title === undefined ? {} : { title: body.title }), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/stage': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; kind?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.kind !== 'preset' && body.kind !== 'lorebook') return sendError(res, 400, 'kind must be preset or lorebook')
        try { sendJson(res, 200, await catalogue.stage({ source: body.source, versionId: body.versionId, kind: body.kind })) }
        catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/lorebook': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown; title?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.title !== undefined && typeof body.title !== 'string') return sendError(res, 400, 'title must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convertLorebook({ source: body.source, versionId: body.versionId, ...(body.title === undefined ? {} : { title: body.title }), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
  }
}
