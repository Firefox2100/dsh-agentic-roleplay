import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SyncDetached, SyncRunResult, SyncSide, SyncStatus, SyncUnitStatus } from '../../shared/sync.ts'
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

/**
 * How long a run or a choice is waited for before the request is answered with "still running": a proxy in front of the host (Cloudflare, 100 s) answers its own error to a request that
 * stays open for a slow unit, though the work goes on. The page reads the status until the work is over.
 */
export const SYNC_HOLD_MS = 20_000

type Settled<T> = { done: true; value: T } | { done: false }

/** The promise's value when it is there within `ms`, else `done: false`; the promise itself is left to finish (its failure is kept by the service). */
async function within<T>(work: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Settled<T>>((resolve) => { timer = setTimeout(() => { resolve({ done: false }) }, ms) })
  try {
    return await Promise.race([work.then((value): Settled<T> => ({ done: true, value })), late])
  } finally {
    clearTimeout(timer)
    work.catch(() => undefined)
  }
}

export function syncRoutes(api: SyncApi, holdMs: number = SYNC_HOLD_MS): Record<string, Partial<Record<string, Route>>> {
  const detached: SyncDetached = { running: true }
  return {
    '/sync/status': { GET: async (_req, res) => { try { sendJson(res, 200, await api.status()) } catch (error) { failure(res, error) } } },
    '/sync/run': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const only = body['units']
        if (only !== undefined && (!Array.isArray(only) || only.some(entry => typeof entry !== 'string'))) return sendError(res, 400, '"units" must be a list of unit ids')
        try {
          const outcome = await within(api.run(only as string[] | undefined), holdMs)
          sendJson(res, outcome.done ? 200 : 202, outcome.done ? outcome.value : detached)
        } catch (error) { failure(res, error) }
      },
    },
    '/sync/resolve': {
      POST: async (req, res) => {
        const { unit, side } = await readJsonBody(req)
        if (typeof unit !== 'string' || (side !== 'local' && side !== 'remote')) return sendError(res, 400, '"unit" must be text and "side" local or remote')
        try {
          const outcome = await within(api.resolve(unit, side), holdMs)
          sendJson(res, outcome.done ? 200 : 202, outcome.done ? outcome.value ?? null : detached)
        } catch (error) { failure(res, error) }
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
