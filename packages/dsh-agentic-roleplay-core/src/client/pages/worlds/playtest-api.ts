import type { WorldCharactersPayload } from '../../../shared/sessions.ts'
import type { PlaytestStatus } from '../../../shared/playtest.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'
import { answer } from './import-api.ts'

export type PlaytestReading = PlaytestStatus | { state: 'idle' }

const address = (worldId: string): string => `${API_PREFIX}/worlds/playtest?id=${encodeURIComponent(worldId)}`

export async function playtestStatus(worldId: string, signal?: AbortSignal): Promise<PlaytestReading> {
  return await answer(await fetch(address(worldId), { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
}

export async function startPlaytest(worldId: string, body: { turns: number; playerCharacterId?: string; language: string }): Promise<PlaytestStatus> {
  return await answer(await fetch(address(worldId), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
}

export async function stopPlaytest(worldId: string): Promise<PlaytestReading> {
  return await answer(await fetch(address(worldId), { method: 'DELETE', credentials: 'same-origin' }))
}

export async function playableCharacters(worldId: string, signal?: AbortSignal): Promise<WorldCharactersPayload['characters']> {
  const payload = await answer<WorldCharactersPayload>(await fetch(`${API_PREFIX}/worlds/characters?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
  return payload.characters.filter(character => character.role === 'playable')
}
