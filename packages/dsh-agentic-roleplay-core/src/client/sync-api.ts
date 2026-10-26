import { SYNC_CHANGED, type SyncRunResult, type SyncSide, type SyncStatus, type SyncUnitStatus } from '../shared/sync.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export interface PasswordStatus {
  configured: boolean
  source?: string
  writable: boolean
  ref: string
}

export async function loadSyncStatus(signal: AbortSignal): Promise<SyncStatus> {
  return await reply(await fetch(`${API_PREFIX}/sync/status`, { credentials: 'same-origin', signal }))
}

/** Syncs every unit, or only the named ones; resolves when the run is over. */
export async function runSync(units: readonly string[] | undefined, signal: AbortSignal): Promise<SyncRunResult> {
  return await reply(await fetch(`${API_PREFIX}/sync/run`, { ...json('POST', units === undefined ? {} : { units }), signal }))
}

export async function resolveSync(unit: string, side: SyncSide, signal: AbortSignal): Promise<SyncUnitStatus | null> {
  return await reply(await fetch(`${API_PREFIX}/sync/resolve`, { ...json('POST', { unit, side }), signal }))
}

/** Stops syncing a unit that was deleted here; the remote's copy stays and is not brought back until `restoreSync`. */
export async function forgetSync(unit: string, signal: AbortSignal): Promise<void> {
  await reply(await fetch(`${API_PREFIX}/sync/forget`, { ...json('POST', { unit }), signal }))
}

/** Lets a unit that was forgotten sync again, which brings the remote's copy back on the next run. */
export async function restoreSync(unit: string, signal: AbortSignal): Promise<void> {
  await reply(await fetch(`${API_PREFIX}/sync/restore`, { ...json('POST', { unit }), signal }))
}

export async function describePassword(reference: string, signal: AbortSignal): Promise<PasswordStatus> {
  return await reply(await fetch(`${API_PREFIX}/sync/password?ref=${encodeURIComponent(reference)}`, { credentials: 'same-origin', signal }))
}

/** Stores the password of the rclone configuration file, or removes it when the value is empty; the value is never sent back. */
export async function storePassword(reference: string, value: string, signal: AbortSignal): Promise<PasswordStatus> {
  const status = await reply<PasswordStatus>(await fetch(`${API_PREFIX}/sync/password`, { ...json('PUT', { ref: reference, value }), signal }))
  window.dispatchEvent(new Event(SYNC_CHANGED))
  return status
}
