import type { InterfaceAvailability, InterfacePayload, PlayerViewReply } from '../../shared/interface-pack.ts'

/** The host says why in `message`; a failure that has none is told by its status. */
async function read<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `${what} (${response.status})`)
  return await response.json() as T
}

const enc = encodeURIComponent

export async function packOf(session: string): Promise<InterfacePayload> {
  return read(await fetch(`roleplay-api/sessions/interface?id=${enc(session)}`), 'the interface pack could not be read')
}

export async function viewOf(session: string, revision?: string): Promise<PlayerViewReply> {
  return read(await fetch(`roleplay-api/sessions/interface/view?id=${enc(session)}${revision === undefined ? '' : `&revision=${enc(revision)}`}`), 'the story could not be read')
}

export async function availability(): Promise<InterfaceAvailability> {
  return read(await fetch('roleplay-api/interface/availability'), 'the interface packs could not be looked up')
}
