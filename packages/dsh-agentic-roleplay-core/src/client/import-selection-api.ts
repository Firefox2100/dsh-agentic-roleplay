import type { SelectionChoice, SelectionKind, SelectionPreview } from '../shared/import-selection.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }) })

export interface OpenedImport { name?: string; chatSessionId: string; started: boolean; failure?: string }

/** Sends a preset or lorebook file to the host to be read: the answer is what it offers to import. */
export async function stageFile(kind: SelectionKind, file: File, signal?: AbortSignal): Promise<SelectionPreview> {
  return await reply(await fetch(`${API_PREFIX}/import/stage?kind=${kind}`, { method: 'POST', credentials: 'same-origin', headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': 'application/json' }, body: file, ...(signal === undefined ? {} : { signal }) }))
}

/** The same for a release of a catalogue, which the host downloads. */
export async function stageRelease(kind: SelectionKind, source: string, versionId: string, signal?: AbortSignal): Promise<SelectionPreview> {
  return await reply(await fetch(`${API_PREFIX}/catalogue/stage`, post({ source, versionId, kind }, signal)))
}

/** Imports a staged preset into a new library preset, named `name`, or after `title` when there is no name; its authoring chat turns the chosen prompts into the preset's own. */
export async function importStagedPreset(choice: SelectionChoice, extra: { name?: string; title?: string; language: string }, signal?: AbortSignal): Promise<OpenedImport> {
  return await reply(await fetch(`${API_PREFIX}/presets/import/staged`, post({ ...choice, ...extra }, signal)))
}

export async function importStagedLorebook(choice: SelectionChoice, extra: { name?: string; title?: string; language: string }, signal?: AbortSignal): Promise<OpenedImport> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/import/staged`, post({ ...choice, ...extra }, signal)))
}

/** Imports a staged preset into a world, whose authoring chat turns the chosen prompts into the world's prose prompts. */
export async function importStagedToWorld(worldId: string, choice: SelectionChoice, language: string): Promise<OpenedImport> {
  return await reply(await fetch(`${API_PREFIX}/worlds/import/preset/staged`, post({ ...choice, worldId, language })))
}

/** Imports the chosen entries of a staged lorebook as they are, with no assistant; the answer names the new lorebook. */
export async function importVerbatimLorebook(choice: SelectionChoice, extra: { name?: string; title?: string; knownBy: 'everyone' | 'master' }, signal?: AbortSignal): Promise<{ name: string; entries: number }> {
  return await reply(await fetch(`${API_PREFIX}/lorebooks/import/verbatim`, post({ ...choice, ...extra }, signal)))
}

/** Imports the chosen prompts of a staged preset as they are, with no assistant; the answer names the new preset. */
export async function importVerbatimPreset(choice: SelectionChoice, extra: { name?: string; title?: string }, signal?: AbortSignal): Promise<{ name: string }> {
  return await reply(await fetch(`${API_PREFIX}/presets/import/verbatim`, post({ ...choice, ...extra }, signal)))
}

/** Puts the chosen prompts of a staged preset into a world as its narration style, word for word, with no assistant. */
export async function importVerbatimToWorld(worldId: string, choice: SelectionChoice, signal?: AbortSignal): Promise<{ preset: string; replaced: boolean }> {
  return await reply(await fetch(`${API_PREFIX}/worlds/import/preset/verbatim`, post({ ...choice, worldId }, signal)))
}
