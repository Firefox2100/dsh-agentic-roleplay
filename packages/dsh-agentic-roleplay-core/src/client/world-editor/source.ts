import type { CharacterEdit, FactionEdit, PlaceEdit, RelationChange, ThingEdit, WorldState } from '../../shared/world-state.ts'

/** Where the editor reads a world from and writes its changes to: a session's story, or a world's files. */
export interface WorldSource {
  load(signal: AbortSignal): Promise<WorldState>
  /** Saves the changes of one character and answers the world as it stands after. */
  saveCharacter(key: string, edit: CharacterEdit, signal: AbortSignal): Promise<WorldState>
  savePlace(key: string, edit: PlaceEdit, signal: AbortSignal): Promise<WorldState>
  saveThing(key: string, edit: ThingEdit, signal: AbortSignal): Promise<WorldState>
  saveFaction(key: string, edit: FactionEdit, signal: AbortSignal): Promise<WorldState>
  saveRelation(edit: RelationChange, signal: AbortSignal): Promise<WorldState>
  saveNarrationVoice(voice: string, signal: AbortSignal): Promise<WorldState>
  listVoices(signal: AbortSignal): Promise<{ id: string; name?: string }[]>
  /** Generate or replace the character's canonical portrait and answer the refreshed world. */
  generatePortrait(key: string, signal: AbortSignal): Promise<WorldState>
}

/** The chat or the world is not something that can be edited: it does not exist, or is not a roleplay session. */
export class NotEditableError extends Error {}

/** What the host said when it refused an edit, in its words. */
export class RefusedEditError extends Error {}

export async function answer(response: Response): Promise<WorldState> {
  if (response.status === 404) throw new NotEditableError('not found')
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
    const problems = Array.isArray(body?.problems) ? body.problems.join('; ') : undefined
    const message = problems ?? (typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
    throw response.status === 422 ? new RefusedEditError(message) : new Error(message)
  }
  return await response.json() as WorldState
}

export async function put(url: string, edit: CharacterEdit | PlaceEdit | ThingEdit | FactionEdit | RelationChange | { voice: string }, signal: AbortSignal): Promise<WorldState> {
  return await answer(await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(edit), signal }))
}

export async function post(url: string, signal: AbortSignal): Promise<WorldState> {
  return await answer(await fetch(url, { method: 'POST', credentials: 'same-origin', signal }))
}

/** Voice discovery is optional: an unavailable or unsupported endpoint leaves manual entry usable. */
export async function listVoices(url: string, signal: AbortSignal): Promise<{ id: string; name?: string }[]> {
  const response = await fetch(url, { credentials: 'same-origin', signal })
  if (!response.ok) return []
  const value = await response.json() as unknown
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): { id: string; name?: string }[] => {
    if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') return []
    const voice = entry as { id: string; name?: unknown }
    return [{ id: voice.id, ...(typeof voice.name === 'string' ? { name: voice.name } : {}) }]
  })
}
