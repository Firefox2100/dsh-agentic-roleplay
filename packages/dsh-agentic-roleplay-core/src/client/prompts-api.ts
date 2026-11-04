import type { PromptDetail, PromptEntry } from '../shared/prompts.ts'
import { API_PREFIX } from '../shared/worlds.ts'

async function reply<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const address = (id: string, language: string, suffix = ''): string => `${API_PREFIX}/prompts/item${suffix}?id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`

export async function listPrompts(signal: AbortSignal): Promise<PromptEntry[]> {
  return await reply(await fetch(`${API_PREFIX}/prompts`, { credentials: 'same-origin', signal }))
}

export async function readPrompt(id: string, language: string, signal: AbortSignal): Promise<PromptDetail> {
  return await reply(await fetch(address(id, language), { credentials: 'same-origin', signal }))
}

export async function savePrompt(id: string, language: string, text: string, signal: AbortSignal): Promise<PromptEntry> {
  return await reply(await fetch(address(id, language), { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal }))
}

/** Replaces the file with the shipped text; the host keeps the old file in the trash. */
export async function resetPrompt(id: string, language: string, signal: AbortSignal): Promise<PromptEntry> {
  return await reply(await fetch(address(id, language, '/reset'), { method: 'POST', credentials: 'same-origin', signal }))
}
