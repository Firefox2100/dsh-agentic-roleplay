import type { IncomingMessage, ServerResponse } from 'node:http'
import { LORE_KINDS, LORE_SCOPES } from 'dsh-roleplay-model'
import type { LorebookEntry, LorebookSummary, LorebookText } from '../../shared/lorebooks.ts'
import { readBinaryBody, readJsonBody } from '../http/body.ts'
import { sendError, sendJson } from '../http/respond.ts'
import { languageOf } from '../prompts/library.ts'
import type { LorebookAuthoringOpened } from './service.ts'
import type { LorebookInfoChange } from './lorebooks.ts'

/** What the routes need of the lorebook service. */
export interface LorebookApi {
  list(): Promise<LorebookSummary[]>
  read(name: string): Promise<LorebookText>
  create(request: { name: string; title?: string; description?: string }): Promise<LorebookSummary>
  updateInfo(name: string, change: LorebookInfoChange): Promise<LorebookSummary>
  writeEntry(name: string, entry: LorebookEntry): Promise<LorebookSummary>
  removeEntry(name: string, id: string): Promise<LorebookSummary>
  remove(name: string): Promise<void>
  author(name: string, language?: string): Promise<{ chatSessionId: string }>
  importFile(name: string, file: Buffer, language?: string): Promise<LorebookAuthoringOpened & { name: string }>
  readonly maxUploadBytes: number
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** A request the library refuses is 422 with its reason; anything else is a fault. */
function failure(res: ServerResponse, error: unknown): void {
  if (error instanceof Error) return sendError(res, 422, error.message)
  throw error
}

const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string')

/** Reads the body of an entry, or says what is wrong with it. */
function entryOf(id: string, body: Record<string, unknown>): LorebookEntry | string {
  const { title, kind, scope, knownBy, summary, body: text, related } = body
  if (typeof title !== 'string') return '"title" must be text'
  if (typeof kind !== 'string' || !(LORE_KINDS as readonly string[]).includes(kind)) return `"kind" must be one of ${LORE_KINDS.join(', ')}`
  if (typeof scope !== 'string' || !(LORE_SCOPES as readonly string[]).includes(scope)) return `"scope" must be one of ${LORE_SCOPES.join(', ')}`
  if (knownBy !== undefined && !texts(knownBy)) return '"knownBy" must be a list of text'
  if (related !== undefined && !texts(related)) return '"related" must be a list of text'
  if ((summary !== undefined && typeof summary !== 'string') || (text !== undefined && typeof text !== 'string')) return '"summary" and "body" must be text'
  return { id, title, kind: kind as LorebookEntry['kind'], scope: scope as LorebookEntry['scope'], knownBy: (knownBy as string[] | undefined)?.map(entry => entry.trim()).filter(entry => entry !== '') ?? [], summary: summary as string | undefined ?? '', body: text as string | undefined ?? '', related: (related as string[] | undefined) ?? [] }
}

export function lorebookRoutes(api: LorebookApi): Record<string, Partial<Record<string, Route>>> {
  return {
    '/lorebooks': {
      GET: async (_req, res) => { try { sendJson(res, 200, await api.list()) } catch (error) { failure(res, error) } },
      POST: async (req, res) => {
        const { name, title, description } = await readJsonBody(req)
        if (typeof name !== 'string' || name === '') return sendError(res, 400, '"name" is required')
        if ((title !== undefined && typeof title !== 'string') || (description !== undefined && typeof description !== 'string')) return sendError(res, 400, '"title" and "description" must be text')
        try { sendJson(res, 201, await api.create({ name, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }) })) } catch (error) { failure(res, error) }
      },
    },
    '/lorebooks/item': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await api.read(url.searchParams.get('name') ?? '')) } catch (error) { failure(res, error) } },
      PUT: async (req, res, url) => {
        const { title, description } = await readJsonBody(req)
        if ((title !== undefined && typeof title !== 'string') || (description !== undefined && typeof description !== 'string')) return sendError(res, 400, '"title" and "description" must be text')
        try { sendJson(res, 200, await api.updateInfo(url.searchParams.get('name') ?? '', { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }) })) } catch (error) { failure(res, error) }
      },
      DELETE: async (_req, res, url) => { try { await api.remove(url.searchParams.get('name') ?? ''); res.statusCode = 204; res.end() } catch (error) { failure(res, error) } },
    },
    '/lorebooks/entry': {
      PUT: async (req, res, url) => {
        const entry = entryOf(url.searchParams.get('id') ?? '', await readJsonBody(req))
        if (typeof entry === 'string') return sendError(res, 400, entry)
        try { sendJson(res, 200, await api.writeEntry(url.searchParams.get('name') ?? '', entry)) } catch (error) { failure(res, error) }
      },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await api.removeEntry(url.searchParams.get('name') ?? '', url.searchParams.get('id') ?? '')) } catch (error) { failure(res, error) } },
    },
    '/lorebooks/authoring': {
      POST: async (req, res, url) => {
        const { language } = await readJsonBody(req)
        if (language !== undefined && typeof language !== 'string') return sendError(res, 400, '"language" must be text')
        try { sendJson(res, 200, await api.author(url.searchParams.get('name') ?? '', language === undefined ? undefined : languageOf(language))) } catch (error) { failure(res, error) }
      },
    },
    '/lorebooks/import': {
      POST: async (req, res, url) => {
        const language = url.searchParams.get('language')
        try { sendJson(res, 200, await api.importFile(url.searchParams.get('name') ?? '', await readBinaryBody(req, api.maxUploadBytes), language === null ? undefined : languageOf(language))) } catch (error) { failure(res, error) }
      },
    },
  }
}
