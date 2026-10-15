import type { HistoryTurn } from '../../../shared/interface-pack.ts'

/** What a surface's requests for the story's past and for what it keeps are answered from: a story, or a preview that has neither. */
export interface FrameBackend {
  history(limit: number): Promise<HistoryTurn[]>
  storage(op: 'get' | 'set' | 'remove', key: string, value?: unknown): Promise<unknown>
}

const enc = encodeURIComponent

async function read<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `${what} (${response.status})`)
  return await response.json() as T
}

const backends = new Map<string, FrameBackend>()

/** The turns and the keeping of a roleplay session; the same object for the same session, so that a frame keeps its bridge. */
export const sessionBackend = (session: string): FrameBackend => backends.get(session) ?? made(session)

const made = (session: string): FrameBackend => {
  const backend = created(session)
  backends.set(session, backend)
  return backend
}

const created = (session: string): FrameBackend => ({
  history: async limit => read(await fetch(`roleplay-api/sessions/interface/history?id=${enc(session)}&limit=${limit}`), 'the story so far could not be read'),
  storage: async (op, key, value) => (await read<{ value: unknown }>(await fetch(`roleplay-api/sessions/interface/storage?id=${enc(session)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, key, ...(value === undefined ? {} : { value }) }) }), 'the pack could not keep that')).value,
})

/** The address of a surface of the pack: its files are found beside it by their relative addresses, so the key stands in the path. */
export const frameAddress = (key: string, file: string, revision: string): string => `roleplay-api/sessions/interface/frame/${enc(key)}/${file.split('/').map(enc).join('/')}?r=${enc(revision)}`
