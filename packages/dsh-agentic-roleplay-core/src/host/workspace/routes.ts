import { FOLDER_ACCESS, type FoldersStatus, type StoryFolder } from '../../shared/folders.ts'
import { readJsonBody } from '../http/body.ts'
import { sendError, sendJson } from '../http/respond.ts'
import { SessionNotFoundError } from '../sessions/errors.ts'
import { InvalidFoldersError } from './folders.ts'
import type { Routes } from '../http/routes/shared.ts'

/** What the routes need of the folders service. */
export interface FoldersApi {
  status(id: string): Promise<FoldersStatus>
  set(id: string, folders: readonly StoryFolder[]): Promise<FoldersStatus>
}

function parseFolders(body: Record<string, unknown>): StoryFolder[] | string {
  if (!Array.isArray(body['folders'])) return '"folders" must be a list'
  const folders: StoryFolder[] = []
  for (const entry of body['folders'] as unknown[]) {
    const folder = entry as Record<string, unknown>
    if (typeof folder !== 'object' || folder === null || typeof folder['path'] !== 'string' || !(FOLDER_ACCESS as readonly unknown[]).includes(folder['access'])) return 'each folder needs a "path" and an "access" of read or write'
    folders.push({ path: folder['path'], access: folder['access'] as StoryFolder['access'] })
  }
  return folders
}

export function folderRoutes(api: FoldersApi): Routes {
  const failed = (res: Parameters<typeof sendError>[0], error: unknown): void => {
    if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
    if (error instanceof InvalidFoldersError) return sendJson(res, 422, { message: error.message, problems: error.problems })
    throw error
  }
  return {
    '/sessions/folders': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await api.status(url.searchParams.get('id') ?? '')) } catch (error) { failed(res, error) } },
      PUT: async (req, res, url) => {
        const folders = parseFolders(await readJsonBody(req))
        if (typeof folders === 'string') return sendError(res, 400, folders)
        try { sendJson(res, 200, await api.set(url.searchParams.get('id') ?? '', folders)) } catch (error) { failed(res, error) }
      },
    },
  }
}
