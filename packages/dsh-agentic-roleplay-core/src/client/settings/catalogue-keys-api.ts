import { CATALOGUE_KEYS_CHANGED, type CatalogueKeyStatus } from '../../shared/catalogue.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

async function reply(response: Response): Promise<CatalogueKeyStatus> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as CatalogueKeyStatus
}

/** What the credential store says about a reference: whether it holds a value, where from, and whether one can be stored; never the value. */
export async function describeKey(ref: string, signal: AbortSignal): Promise<CatalogueKeyStatus> {
  return await reply(await fetch(`${API_PREFIX}/catalogue/key?ref=${encodeURIComponent(ref)}`, { credentials: 'same-origin', signal }))
}

/** Stores a key under a reference, or removes the stored one when the value is empty. The value goes to the host and is never sent back. */
export async function storeKey(ref: string, value: string, signal: AbortSignal): Promise<CatalogueKeyStatus> {
  const status = await reply(await fetch(`${API_PREFIX}/catalogue/key`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, value }), signal }))
  window.dispatchEvent(new Event(CATALOGUE_KEYS_CHANGED))
  return status
}
