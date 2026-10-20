import type { PresetChange, PresetStatus, PresetSummary, SavePresetRequest } from '../shared/presets.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export async function listPresets(signal: AbortSignal): Promise<PresetSummary[]> {
  return await reply(await fetch(`${API_PREFIX}/presets`, { credentials: 'same-origin', signal }))
}

/** Makes a preset of the prose prompts a world carries. */
export async function savePresetFromWorld(request: SavePresetRequest, signal: AbortSignal): Promise<PresetSummary> {
  return await reply(await fetch(`${API_PREFIX}/presets`, { ...json('POST', request), signal }))
}

export async function loadPresetStatus(session: string, signal: AbortSignal): Promise<PresetStatus> {
  return await reply(await fetch(`${API_PREFIX}/sessions/preset?id=${encodeURIComponent(session)}`, { credentials: 'same-origin', signal }))
}

/** Puts a preset into the chat's story, or takes its preset out when no name is given. */
export async function applyPreset(session: string, name: string | undefined, signal: AbortSignal): Promise<PresetChange> {
  return await reply(await fetch(`${API_PREFIX}/sessions/preset?id=${encodeURIComponent(session)}`, { ...json('POST', name === undefined ? {} : { name }), signal }))
}

export interface PresetText { summary: PresetSummary; prompts: Record<string, string> }

const empty = async (response: Response): Promise<void> => {
  if (!response.ok) await reply(response)
}

export async function readPreset(name: string, signal: AbortSignal): Promise<PresetText> {
  return await reply(await fetch(`${API_PREFIX}/presets/item?name=${encodeURIComponent(name)}`, { credentials: 'same-origin', signal }))
}

/** Makes a preset holding the shipped prose prompts, as a starting point to edit. */
export async function createPreset(request: Omit<SavePresetRequest, 'fromWorld'>, signal: AbortSignal): Promise<PresetSummary> {
  return await reply(await fetch(`${API_PREFIX}/presets`, { ...json('POST', request), signal }))
}

export async function updatePresetInfo(name: string, change: { title?: string; description?: string; sampling?: { master?: number; characters?: number } }, signal: AbortSignal): Promise<PresetSummary> {
  return await reply(await fetch(`${API_PREFIX}/presets/item?name=${encodeURIComponent(name)}`, { ...json('PUT', change), signal }))
}

export async function writePresetPrompt(name: string, language: string, id: string, text: string, signal: AbortSignal): Promise<PresetSummary> {
  return await reply(await fetch(`${API_PREFIX}/presets/prompt?name=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}&id=${encodeURIComponent(id)}`, { ...json('PUT', { text }), signal }))
}

export async function removePresetPrompt(name: string, language: string, id: string, signal: AbortSignal): Promise<PresetSummary> {
  return await reply(await fetch(`${API_PREFIX}/presets/prompt?name=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}&id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', signal }))
}

export async function deletePreset(name: string, signal: AbortSignal): Promise<void> {
  await empty(await fetch(`${API_PREFIX}/presets/item?name=${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'same-origin', signal }))
}

/** Opens the authoring chat of a preset. */
export async function authorPreset(name: string, language: string, signal: AbortSignal): Promise<{ chatSessionId: string }> {
  return await reply(await fetch(`${API_PREFIX}/presets/authoring?name=${encodeURIComponent(name)}`, { ...json('POST', { language }), signal }))
}

/** Sends a SillyTavern preset to a new library preset, whose authoring chat turns it into prompts. */
export async function importPreset(name: string, file: File, language: string, signal: AbortSignal): Promise<{ name: string; chatSessionId: string; started: boolean; failure?: string }> {
  return await reply(await fetch(`${API_PREFIX}/presets/import?name=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: file, signal }))
}
