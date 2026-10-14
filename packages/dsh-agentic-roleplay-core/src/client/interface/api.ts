import type { HistoryTurn, InterfaceAvailability, InterfacePayload, PlayerViewReply } from '../../shared/interface-pack.ts'

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

export async function historyOf(session: string, limit: number): Promise<HistoryTurn[]> {
  return read(await fetch(`roleplay-api/sessions/interface/history?id=${enc(session)}&limit=${limit}`), 'the story so far could not be read')
}

export async function storeOf(session: string, request: { op: 'get' | 'set' | 'remove'; key: string; value?: unknown }): Promise<unknown> {
  const answer = await read<{ value: unknown }>(await fetch(`roleplay-api/sessions/interface/storage?id=${enc(session)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }), 'the pack could not keep that')
  return answer.value
}

export async function availability(): Promise<InterfaceAvailability> {
  return read(await fetch('roleplay-api/interface/availability'), 'the interface packs could not be looked up')
}

/** The address of a surface of the pack: its files are found beside it by their relative addresses, so the key stands in the path. */
export const frameAddress = (key: string, file: string, revision: string): string => `roleplay-api/sessions/interface/frame/${enc(key)}/${file.split('/').map(enc).join('/')}?r=${enc(revision)}`
