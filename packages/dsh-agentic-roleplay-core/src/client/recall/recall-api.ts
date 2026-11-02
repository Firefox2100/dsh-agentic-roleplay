import type { RecallPreview } from '../../shared/recall-preview.ts'
import type { WorldState } from '../../shared/world-state.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

const failure = async (response: Response): Promise<Error> => {
  const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
  return new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
}

/** What the moment would bring back for the characters of the story, without playing it. */
export async function previewRecall(session: string, situation: string, character: string | undefined, signal: AbortSignal): Promise<RecallPreview> {
  const response = await fetch(`${API_PREFIX}/sessions/recall?id=${encodeURIComponent(session)}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ situation, ...(character === undefined ? {} : { character }) }) })
  if (!response.ok) throw await failure(response)
  return await response.json() as RecallPreview
}

/** The characters an agent plays, to pick one from. */
export async function loadCharacters(session: string, signal: AbortSignal): Promise<{ key: string; name: string }[]> {
  const response = await fetch(`${API_PREFIX}/sessions/world?id=${encodeURIComponent(session)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw await failure(response)
  return ((await response.json()) as WorldState).characters.filter(character => character.control === 'agent').map(({ key, name }) => ({ key, name }))
}
