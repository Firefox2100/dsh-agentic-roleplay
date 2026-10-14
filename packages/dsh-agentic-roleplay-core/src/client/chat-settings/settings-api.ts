import type { RunDetail } from '../../shared/activity.ts'
import type { InterfaceStatus, InterfaceSync } from '../../shared/interface-pack.ts'
import type { ChatSettings, SettingsPayload } from '../../shared/settings.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

/** The chat is not a roleplay session, so it has no settings. */
export class NotRoleplayError extends Error {}

async function receive(response: Response): Promise<SettingsPayload> {
  if (response.status === 404) throw new NotRoleplayError('not a roleplay session')
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
    const problems = Array.isArray(body?.problems) ? ` (${body.problems.join('; ')})` : ''
    throw new Error(`${typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()}${problems === ' ()' ? '' : problems}`)
  }
  return await response.json() as SettingsPayload
}

const url = (id: string): string => `${API_PREFIX}/sessions/settings?id=${encodeURIComponent(id)}`

/** @throws {NotRoleplayError} when the id names no roleplay session. */
export async function loadSettings(id: string, signal: AbortSignal): Promise<SettingsPayload> {
  return await receive(await fetch(url(id), { credentials: 'same-origin', signal }))
}

export async function saveSettings(id: string, settings: ChatSettings, signal: AbortSignal): Promise<SettingsPayload> {
  return await receive(await fetch(url(id), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
    signal,
  }))
}

/** Forgets the chat's stored search vectors. */
export async function resetVectors(id: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${API_PREFIX}/sessions/vectors/reset?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
}

/** What a helper run was told and did; nothing when the run was not kept or has been dropped. */
export async function loadRun(id: string, run: string, signal: AbortSignal): Promise<RunDetail | undefined> {
  const response = await fetch(`${API_PREFIX}/sessions/activity/run?id=${encodeURIComponent(id)}&run=${encodeURIComponent(run)}`, { credentials: 'same-origin', signal })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return await response.json() as RunDetail
}

async function interfaceReply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
    const problems = Array.isArray(body?.problems) ? body.problems.map((problem: { path?: string; message?: string }) => `${problem.path ?? ''} ${problem.message ?? ''}`.trim()).join('; ') : ''
    throw new Error(`${typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()}${problems === '' ? '' : ` (${problems})`}`)
  }
  return await response.json() as T
}

/** The interface pack of the chat's story: the one in use, the ones it could use, and how the world's compare with its copies. */
export async function loadInterfaceStatus(id: string, signal: AbortSignal): Promise<InterfaceStatus> {
  return await interfaceReply(await fetch(`${API_PREFIX}/sessions/interface/status?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', signal }))
}

/** Brings the world's interface packs into the chat's story. */
export async function syncInterface(id: string, signal: AbortSignal): Promise<InterfaceSync> {
  return await interfaceReply(await fetch(`${API_PREFIX}/sessions/interface/sync?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', signal }))
}
