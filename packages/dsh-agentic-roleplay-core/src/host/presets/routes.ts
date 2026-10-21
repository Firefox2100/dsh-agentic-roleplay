import type { IncomingMessage, ServerResponse } from 'node:http'
import { PresetBusyError, type PresetAuthoringOpened } from './service.ts'
import type { PresetInfoChange } from './presets.ts'
import type { PresetChange, PresetSampling, PresetStatus, PresetSummary, SavePresetRequest } from '../../shared/presets.ts'
import { parseSampling } from '../../shared/sampling.ts'
import type { SelectionChoice } from '../../shared/import-selection.ts'
import { parseSelectionChoice } from '../import/staging.ts'
import { ImportNotFoundError } from '../import/store.ts'
import { readBinaryBody, readJsonBody } from '../http/body.ts'
import { languageOf } from '../prompts/library.ts'
import { sendError, sendJson } from '../http/respond.ts'
import { SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'

/** What the routes need of the preset service. */
export interface PresetApi {
  list(): PresetSummary[]
  read(name: string): { summary: PresetSummary; prompts: Record<string, string> }
  create(request: Omit<SavePresetRequest, 'fromWorld'> & { fromWorld?: string }): Promise<PresetSummary>
  updateInfo(name: string, change: PresetInfoChange): Promise<PresetSummary>
  writePrompt(name: string, language: string, id: string, text: string | undefined): Promise<PresetSummary>
  rulesPrompts(name: string, language: string): string[]
  promptText(name: string, language: string, id: string): string
  author(name: string, language?: string): Promise<{ chatSessionId: string }>
  importFile(name: string, file: Buffer, language?: string): Promise<PresetAuthoringOpened & { name: string }>
  importStaged(request: SelectionChoice & { name?: string; title?: string; language?: string }): Promise<PresetAuthoringOpened & { name: string }>
  importVerbatim(request: SelectionChoice & { name?: string; title?: string }): Promise<{ name: string }>
  readonly maxUploadBytes: number
  remove(name: string): Promise<void>
  status(session: string): PresetStatus
  apply(session: string, name: string | undefined): PresetChange
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** Not found is 404 and a request the library refuses is 422 with its reason; anything else is a fault. */
function failure(res: ServerResponse, error: unknown): void {
  if (error instanceof ImportNotFoundError) return sendError(res, 404, error.message)
  if (error instanceof SessionNotFoundError || error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
  if (error instanceof PresetBusyError) return sendError(res, 409, error.message)
  if (error instanceof Error) return sendError(res, 422, error.message)
  throw error
}

function samplingOf(value: unknown): PresetSampling | string {
  const problems: string[] = []
  const sampling = parseSampling(value, 'sampling', problems)
  return problems.length === 0 ? sampling : problems.join('; ')
}

export function presetRoutes(api: PresetApi): Record<string, Partial<Record<string, Route>>> {
  return {
    '/presets': {
      GET: async (_req, res) => { try { sendJson(res, 200, api.list()) } catch (error) { failure(res, error) } },
      POST: async (req, res) => {
        const { name, title, description, sampling, fromWorld } = await readJsonBody(req)
        if (typeof name !== 'string' || name === '') return sendError(res, 400, '"name" is required')
        if (fromWorld !== undefined && (typeof fromWorld !== 'string' || fromWorld === '')) return sendError(res, 400, '"fromWorld" must be a world id, or left out to start from the shipped prompts')
        if ((title !== undefined && typeof title !== 'string') || (description !== undefined && typeof description !== 'string')) return sendError(res, 400, '"title" and "description" must be text')
        const given = samplingOf(sampling)
        if (typeof given === 'string') return sendError(res, 400, given)
        try { sendJson(res, 201, await api.create({ name, ...(fromWorld === undefined ? {} : { fromWorld: fromWorld as string }), ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), sampling: given })) } catch (error) { failure(res, error) }
      },
    },
    '/presets/item': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, api.read(url.searchParams.get('name') ?? '')) } catch (error) { failure(res, error) } },
      PUT: async (req, res, url) => {
        const { title, description, sampling } = await readJsonBody(req)
        if ((title !== undefined && typeof title !== 'string') || (description !== undefined && typeof description !== 'string')) return sendError(res, 400, '"title" and "description" must be text')
        const given = sampling === undefined ? undefined : samplingOf(sampling)
        if (typeof given === 'string') return sendError(res, 400, given)
        try { sendJson(res, 200, await api.updateInfo(url.searchParams.get('name') ?? '', { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(given === undefined ? {} : { sampling: given }) })) } catch (error) { failure(res, error) }
      },
      DELETE: async (_req, res, url) => { try { await api.remove(url.searchParams.get('name') ?? ''); res.statusCode = 204; res.end() } catch (error) { failure(res, error) } },
    },
    '/presets/prompts': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, api.rulesPrompts(url.searchParams.get('name') ?? '', languageOf(url.searchParams.get('language') ?? ''))) } catch (error) { failure(res, error) } },
    },
    '/presets/prompt': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, { text: api.promptText(url.searchParams.get('name') ?? '', languageOf(url.searchParams.get('language') ?? ''), url.searchParams.get('id') ?? '') }) } catch (error) { failure(res, error) } },
      PUT: async (req, res, url) => {
        const { text } = await readJsonBody(req)
        if (typeof text !== 'string' || text.trim() === '') return sendError(res, 400, '"text" is required')
        try { sendJson(res, 200, await api.writePrompt(url.searchParams.get('name') ?? '', languageOf(url.searchParams.get('language') ?? ''), url.searchParams.get('id') ?? '', text)) } catch (error) { failure(res, error) }
      },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await api.writePrompt(url.searchParams.get('name') ?? '', languageOf(url.searchParams.get('language') ?? ''), url.searchParams.get('id') ?? '', undefined)) } catch (error) { failure(res, error) } },
    },
    '/presets/authoring': {
      POST: async (req, res, url) => {
        const { language } = await readJsonBody(req)
        if (language !== undefined && typeof language !== 'string') return sendError(res, 400, '"language" must be text')
        try { sendJson(res, 200, await api.author(url.searchParams.get('name') ?? '', language === undefined ? undefined : languageOf(language))) } catch (error) { failure(res, error) }
      },
    },
    '/presets/import/verbatim': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { name, title } = body as Record<string, unknown>
        for (const [field, value] of [['name', name], ['title', title]] as const) if (value !== undefined && typeof value !== 'string') return sendError(res, 400, `"${field}" must be text`)
        try { sendJson(res, 200, await api.importVerbatim({ ...choice, ...(name === undefined ? {} : { name: name as string }), ...(title === undefined ? {} : { title: title as string }) })) } catch (error) { failure(res, error) }
      },
    },
    '/presets/import/staged': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { name, title, language } = body as Record<string, unknown>
        for (const [field, value] of [['name', name], ['title', title], ['language', language]] as const) if (value !== undefined && typeof value !== 'string') return sendError(res, 400, `"${field}" must be text`)
        try { sendJson(res, 200, await api.importStaged({ ...choice, ...(name === undefined ? {} : { name: name as string }), ...(title === undefined ? {} : { title: title as string }), ...(language === undefined ? {} : { language: languageOf(language as string) }) })) } catch (error) { failure(res, error) }
      },
    },
    '/presets/import': {
      POST: async (req, res, url) => {
        const language = url.searchParams.get('language')
        try { sendJson(res, 200, await api.importFile(url.searchParams.get('name') ?? '', await readBinaryBody(req, api.maxUploadBytes), language === null ? undefined : languageOf(language))) } catch (error) { failure(res, error) }
      },
    },
    '/sessions/preset': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, api.status(url.searchParams.get('id') ?? '')) } catch (error) { failure(res, error) } },
      POST: async (req, res, url) => {
        const { name } = await readJsonBody(req)
        if (name !== undefined && name !== null && (typeof name !== 'string' || name === '')) return sendError(res, 400, '"name" must be a preset name, or left out to take the preset out')
        try { sendJson(res, 200, api.apply(url.searchParams.get('id') ?? '', typeof name === 'string' ? name : undefined)) } catch (error) { failure(res, error) }
      },
    },
  }
}
