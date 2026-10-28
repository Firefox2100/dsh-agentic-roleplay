import type { CatalogueKind, CatalogueSourceStatus, CatalogueUpdates, CatalogueWorldDetail, CatalogueWorldPage, ConflictReason, ConvertRequest, ConvertResult, InstallRequest, InstallResult } from '../../../shared/catalogue.ts'
import type { ImportChoices, ImportPreview } from '../../../shared/import-card.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'
import { trimCharacters } from '../../../shared/text.ts'

/** The host refused to go on because of something the person can decide: a world they already have, or one they changed. */
export class InstallConflict extends Error {
  constructor(message: string, readonly reason: ConflictReason, readonly changes: string[]) {
    super(message)
  }
}

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; reason?: unknown; changes?: unknown } | undefined
    const message = typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()
    if (response.status === 409 && (body?.reason === 'exists' || body?.reason === 'modified' || body?.reason === 'unverified')) {
      throw new InstallConflict(message, body.reason, Array.isArray(body.changes) ? body.changes.filter((line): line is string => typeof line === 'string') : [])
    }
    throw new Error(message)
  }
  return await response.json() as T
}

const get = async <T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> =>
  await answer(await fetch(`${API_PREFIX}/catalogue/${path}?${new URLSearchParams(params)}`, { credentials: 'same-origin', signal }))

export const loadSources = async (signal: AbortSignal): Promise<CatalogueSourceStatus[]> => await get('sources', {}, signal)

export const loadWorlds = async (source: string, kind: CatalogueKind, search: string, sort: 'recent' | 'popular', offset: number, signal: AbortSignal): Promise<CatalogueWorldPage> =>
  await get('worlds', { source, kind, search, sort, offset: String(offset) }, signal)

export const loadUpdates = async (source: string, signal: AbortSignal): Promise<CatalogueUpdates> => await get('updates', { source }, signal)

export const loadWorld = async (source: string, id: string, signal: AbortSignal): Promise<CatalogueWorldDetail> => await get('world', { source, id }, signal)

/** Where the host serves a world's cover from, asked with the catalogue's key. */
export const coverUrl = (source: string, id: string): string => `${API_PREFIX}/catalogue/cover?${new URLSearchParams({ source, id })}`

export async function install(request: InstallRequest): Promise<InstallResult> {
  return await answer(await fetch(`${API_PREFIX}/catalogue/install`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }))
}

export async function convert(request: ConvertRequest): Promise<ConvertResult> {
  return await answer(await fetch(`${API_PREFIX}/catalogue/convert`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }))
}

/** Downloads a card of a catalogue and has the host read it, so that the person can look through it before a world is made. */
export async function stageCard(source: string, versionId: string): Promise<ImportPreview> {
  return await answer(await fetch(`${API_PREFIX}/catalogue/stage/card`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, versionId }) }))
}

/** Makes the world of a card that was staged, with the choices the person made. */
export async function convertStaged(request: ConvertRequest & { id: string; choices: ImportChoices; update?: string }): Promise<ConvertResult> {
  return await answer(await fetch(`${API_PREFIX}/catalogue/convert/staged`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }))
}

/** Lets the host forget a card that was staged and not used. */
export async function discardCard(id: string): Promise<void> {
  await fetch(`${API_PREFIX}/worlds/import?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
}

/** The address a catalogue serves a release's archive from. */
export function downloadUrl(baseUrl: string, versionId: string): string {
  return `${trimCharacters(baseUrl.trim(), '/', 'end')}/versions/${encodeURIComponent(versionId)}/download`
}
