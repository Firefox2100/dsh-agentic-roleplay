import type { RoutineDefinition } from 'dsh-roleplay-model'
import type { PackPreview, WorldPackDetail } from '../../shared/interface-pack.ts'
import type { DiceDocument } from '../../shared/world-dice.ts'
import type { CalendarDocument, VariableDeclaration, WorldRoutines } from '../../shared/world-daily.ts'
import type { WorldInfo, WorldInfoEdit } from '../../shared/world-info.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { RefusedEditError } from './source.ts'

export interface PromptEntry { id: string; kind: 'prose' | 'rules'; carried: boolean }
export interface PromptText { id: string; language: string; carried: boolean; text: string }

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
    const problems = Array.isArray(body?.problems) ? body.problems.join('; ') : undefined
    const message = problems ?? (typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
    throw response.status === 422 ? new RefusedEditError(message) : new Error(message)
  }
  return await response.json() as T
}

const query = (world: string, language?: string, prompt?: string): string => `id=${encodeURIComponent(world)}${language === undefined ? '' : `&language=${encodeURIComponent(language)}`}${prompt === undefined ? '' : `&prompt=${encodeURIComponent(prompt)}`}`
const init = (method: string, signal: AbortSignal, body?: unknown): RequestInit => ({ method, credentials: 'same-origin', signal, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

export const loadInfo = async (world: string, signal: AbortSignal): Promise<WorldInfo> => await read(await fetch(`${API_PREFIX}/worlds/info?${query(world)}`, init('GET', signal)))
export const saveInfo = async (world: string, edit: WorldInfoEdit, signal: AbortSignal): Promise<WorldInfo> => await read(await fetch(`${API_PREFIX}/worlds/info?${query(world)}`, init('PUT', signal, edit)))
export const loadPrompts = async (world: string, language: string, signal: AbortSignal): Promise<PromptEntry[]> => await read(await fetch(`${API_PREFIX}/worlds/prompts?${query(world, language)}`, init('GET', signal)))
export const loadPrompt = async (world: string, language: string, prompt: string, signal: AbortSignal): Promise<PromptText> => await read(await fetch(`${API_PREFIX}/worlds/prompts/item?${query(world, language, prompt)}`, init('GET', signal)))
export const savePrompt = async (world: string, language: string, prompt: string, text: string, signal: AbortSignal): Promise<void> => { await read(await fetch(`${API_PREFIX}/worlds/prompts/item?${query(world, language, prompt)}`, init('PUT', signal, { text }))) }
export const removePrompt = async (world: string, language: string, prompt: string, signal: AbortSignal): Promise<void> => { await read(await fetch(`${API_PREFIX}/worlds/prompts/item?${query(world, language, prompt)}`, init('DELETE', signal))) }
export const loadRoutines = async (world: string, signal: AbortSignal): Promise<WorldRoutines> => await read(await fetch(`${API_PREFIX}/worlds/routines?${query(world)}`, init('GET', signal)))
export const saveRoutine = async (world: string, key: string, windows: readonly RoutineDefinition[], signal: AbortSignal): Promise<WorldRoutines> => await read(await fetch(`${API_PREFIX}/worlds/routines/item?${query(world)}&key=${encodeURIComponent(key)}`, init('PUT', signal, { windows })))
export const loadDice = async (world: string, signal: AbortSignal): Promise<DiceDocument> => await read(await fetch(`${API_PREFIX}/worlds/dice?${query(world)}`, init('GET', signal)))
export const saveDice = async (world: string, dice: DiceDocument, signal: AbortSignal): Promise<DiceDocument> => await read(await fetch(`${API_PREFIX}/worlds/dice?${query(world)}`, init('PUT', signal, dice)))
export const loadCalendar = async (world: string, signal: AbortSignal): Promise<CalendarDocument> => await read(await fetch(`${API_PREFIX}/worlds/calendar?${query(world)}`, init('GET', signal)))
export const saveCalendar = async (world: string, calendar: CalendarDocument, signal: AbortSignal): Promise<CalendarDocument> => await read(await fetch(`${API_PREFIX}/worlds/calendar?${query(world)}`, init('PUT', signal, calendar)))
export const loadVariables = async (world: string, signal: AbortSignal): Promise<VariableDeclaration[]> => await read(await fetch(`${API_PREFIX}/worlds/variables?${query(world)}`, init('GET', signal)))
export const saveVariables = async (world: string, variables: readonly VariableDeclaration[], signal: AbortSignal): Promise<VariableDeclaration[]> => await read(await fetch(`${API_PREFIX}/worlds/variables?${query(world)}`, init('PUT', signal, { variables })))

export const loadWorldPacks = async (world: string, signal: AbortSignal): Promise<WorldPackDetail[]> => await read(await fetch(`${API_PREFIX}/worlds/interface?${query(world)}`, init('GET', signal)))
export const loadPackPreview = async (world: string, pack: string, signal: AbortSignal): Promise<PackPreview> => await read(await fetch(`${API_PREFIX}/worlds/interface/preview?${query(world)}&pack=${encodeURIComponent(pack)}`, init('GET', signal)))

/** The playable characters of an authored world, for choosing whom an opening is for. */
export async function loadPlayable(worldId: string, signal: AbortSignal): Promise<{ id: string; name: string }[]> {
  const response = await fetch(`${API_PREFIX}/worlds/characters?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  const { characters } = await response.json() as { characters: { id: string; name: string; role: string }[] }
  return characters.filter(character => character.role === 'playable').map(({ id, name }) => ({ id, name }))
}
