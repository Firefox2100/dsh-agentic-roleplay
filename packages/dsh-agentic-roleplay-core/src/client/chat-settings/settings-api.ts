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
