import { readJsonBody } from '../http/body.ts'
import { sendError, sendJson } from '../http/respond.ts'
import type { Routes } from '../http/routes/shared.ts'
import type { PromptDetail, PromptEntry } from '../../shared/prompts.ts'
import { PromptEditError } from './manage.ts'

/** What the routes need of the prompt manager. */
export interface PromptsApi {
  list(): PromptEntry[]
  read(id: string, language: string): PromptDetail
  write(id: string, language: string, text: string): Promise<PromptEntry>
  reset(id: string, language: string): Promise<PromptEntry>
}

export function promptRoutes(api: PromptsApi): Routes {
  const fail = (res: Parameters<typeof sendError>[0], error: unknown): void => {
    if (error instanceof PromptEditError) return sendError(res, 422, error.message)
    throw error
  }
  const target = (url: URL): { id: string; language: string } => ({ id: url.searchParams.get('id') ?? '', language: url.searchParams.get('language') ?? '' })
  return {
    '/prompts': { GET: async (_req, res) => { sendJson(res, 200, api.list()) } },
    '/prompts/item': {
      GET: async (_req, res, url) => { try { const { id, language } = target(url); sendJson(res, 200, api.read(id, language)) } catch (error) { fail(res, error) } },
      PUT: async (req, res, url) => {
        const { text } = await readJsonBody(req)
        if (typeof text !== 'string') return sendError(res, 400, '"text" must be text')
        try { const { id, language } = target(url); sendJson(res, 200, await api.write(id, language, text)) } catch (error) { fail(res, error) }
      },
    },
    '/prompts/item/reset': {
      POST: async (_req, res, url) => { try { const { id, language } = target(url); sendJson(res, 200, await api.reset(id, language)) } catch (error) { fail(res, error) } },
    },
  }
}
