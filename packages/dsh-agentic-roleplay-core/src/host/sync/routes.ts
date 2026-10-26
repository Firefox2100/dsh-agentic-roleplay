import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SyncRunResult, SyncSide, SyncStatus, SyncUnitStatus } from '../../shared/sync.ts'
import { CREDENTIAL_REF } from '../../shared/catalogue.ts'
import { readJsonBody } from '../http/body.ts'
import { sendError, sendJson } from '../http/respond.ts'
import { RcloneError, SyncRefusedError, UnitLockedError } from './errors.ts'

/** What the routes need of the sync service. */
export interface SyncApi {
  status(): Promise<SyncStatus>
  run(only?: readonly string[]): Promise<SyncRunResult>
  resolve(unit: string, side: SyncSide): Promise<SyncUnitStatus | undefined>
  /** Stops syncing a unit that was deleted here, leaving the remote's copy alone. */
  forget(unit: string): void
  /** Syncs a unit that was forgotten again. */
  restore(unit: string): void
  /** The password's credential: whether one is stored, and storing or removing it. */
  password: {
    describe(reference?: string): Promise<{ configured: boolean; source?: string; writable: boolean; ref: string }>
    keep(value: string, reference?: string): Promise<{ configured: boolean; source?: string; writable: boolean; ref: string }>
  }
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

export function failure(res: ServerResponse, error: unknown): void {
  if (error instanceof UnitLockedError) return sendError(res, 423, error.message)
  if (error instanceof SyncRefusedError) return sendError(res, 409, error.message)
  if (error instanceof RcloneError) return sendError(res, 502, error.message)
  throw error
}

export function syncRoutes(api: SyncApi): Record<string, Partial<Record<string, Route>>> {
  return {
    '/sync/status': { GET: async (_req, res) => { try { sendJson(res, 200, await api.status()) } catch (error) { failure(res, error) } } },
    '/sync/run': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const only = body['units']
        if (only !== undefined && (!Array.isArray(only) || only.some(entry => typeof entry !== 'string'))) return sendError(res, 400, '"units" must be a list of unit ids')
        try { sendJson(res, 200, await api.run(only as string[] | undefined)) } catch (error) { failure(res, error) }
      },
    },
    '/sync/resolve': {
      POST: async (req, res) => {
        const { unit, side } = await readJsonBody(req)
        if (typeof unit !== 'string' || (side !== 'local' && side !== 'remote')) return sendError(res, 400, '"unit" must be text and "side" local or remote')
        try { sendJson(res, 200, (await api.resolve(unit, side)) ?? null) } catch (error) { failure(res, error) }
      },
    },
    '/sync/forget': {
      POST: async (req, res) => {
        const { unit } = await readJsonBody(req)
        if (typeof unit !== 'string') return sendError(res, 400, '"unit" must be text')
        try { api.forget(unit); sendJson(res, 200, {}) } catch (error) { failure(res, error) }
      },
    },
    '/sync/restore': {
      POST: async (req, res) => {
        const { unit } = await readJsonBody(req)
        if (typeof unit !== 'string') return sendError(res, 400, '"unit" must be text')
        try { api.restore(unit); sendJson(res, 200, {}) } catch (error) { failure(res, error) }
      },
    },
    '/sync/password': {
      GET: async (_req, res, url) => {
        const reference = url.searchParams.get('ref') ?? undefined
        if (reference !== undefined && !CREDENTIAL_REF.test(reference)) return sendError(res, 400, '"ref" must be a credential name')
        sendJson(res, 200, await api.password.describe(reference))
      },
      PUT: async (req, res) => {
        const { ref, value } = await readJsonBody(req)
        if (typeof value !== 'string') return sendError(res, 400, '"value" must be text')
        if (ref !== undefined && (typeof ref !== 'string' || !CREDENTIAL_REF.test(ref))) return sendError(res, 400, '"ref" must be a credential name')
        try { sendJson(res, 200, await api.password.keep(value, ref)) } catch (error) { if (error instanceof SyncRefusedError) return sendError(res, 409, error.message); throw error }
      },
    },
  }
}
