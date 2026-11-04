import type { WorldCharactersPayload } from '../../../shared/sessions.ts'
import type { PlaytestStatus } from '../../../shared/playtest.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'
import { answer } from './import-api.ts'

export type PlaytestReading = PlaytestStatus | { state: 'idle' }

const address = (worldId: string): string => `${API_PREFIX}/worlds/playtest?id=${encodeURIComponent(worldId)}`

export async function playtestStatus(worldId: string, signal?: AbortSignal): Promise<PlaytestReading> {
  return await answer(await fetch(address(worldId), { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
}

export async function startPlaytest(worldId: string, body: { turns: number; playerCharacterId?: string; opening?: number; startingTime?: string; language: string }): Promise<PlaytestStatus> {
  return await answer(await fetch(address(worldId), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
}

export async function stopPlaytest(worldId: string): Promise<PlaytestReading> {
  return await answer(await fetch(address(worldId), { method: 'DELETE', credentials: 'same-origin' }))
}

export interface PlaytestChoices { players: WorldCharactersPayload['characters']; openings: WorldCharactersPayload['openings']; startingTime: string; timeZone: string }

export async function playtestChoices(worldId: string, signal?: AbortSignal): Promise<PlaytestChoices> {
  const payload = await answer<WorldCharactersPayload>(await fetch(`${API_PREFIX}/worlds/characters?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
  return { players: payload.characters.filter(character => character.role === 'playable'), openings: payload.openings, startingTime: payload.startingTime, timeZone: payload.timeZone }
}
