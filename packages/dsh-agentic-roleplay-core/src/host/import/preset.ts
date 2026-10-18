import { ImportCardError } from './card.ts'

/** A narration preset: the instruction texts of a SillyTavern prompt preset, in the order it sends them. */
export interface Preset {
  name: string
  pieces: string[]
}

/** The older preset layout keeps its texts under fixed keys. */
const LEGACY_KEYS = ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt', 'impersonation_prompt', 'new_chat_prompt', 'new_group_chat_prompt', 'new_example_chat_prompt'] as const

const MAX_PIECES = 60
const MAX_PIECE_CHARS = 8000

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The order the preset sends its prompts in: the longest list it gives, with what each entry says about being on. */
function orderOf(root: Json): { identifier: string; enabled: boolean }[] {
  const lists = Array.isArray(root['prompt_order']) ? root['prompt_order'].flatMap(entry => (isObject(entry) && Array.isArray(entry['order']) ? [entry['order']] : [])) : []
  const longest = lists.sort((a, b) => b.length - a.length)[0] ?? []
  return longest.flatMap((entry) => (isObject(entry) && typeof entry['identifier'] === 'string' ? [{ identifier: entry['identifier'], enabled: entry['enabled'] !== false }] : []))
}

/**
 * Reads a preset file. Markers (places where chat history or the card's fields are inserted), switched-off prompts and empty ones are left out.
 * @throws {ImportCardError} when the file is not a preset, with why.
 */
export function readPreset(file: Buffer, name: string): Preset {
  let root: unknown
  try { root = JSON.parse(file.toString('utf8').replace(/^﻿/, '')) } catch { throw new ImportCardError('the file is not JSON: a preset is the .json file SillyTavern exports') }
  if (!isObject(root)) throw new ImportCardError('the file is not a preset: it must be a JSON object')
  const pieces: string[] = []
  const prompts = Array.isArray(root['prompts']) ? root['prompts'].filter(isObject) : []
  if (prompts.length > 0) {
    const byId = new Map(prompts.flatMap(prompt => (typeof prompt['identifier'] === 'string' ? [[prompt['identifier'], prompt] as const] : [])))
    const ordered = orderOf(root)
    const chosen = ordered.length > 0 ? ordered.flatMap(entry => (entry.enabled && byId.has(entry.identifier) ? [byId.get(entry.identifier)!] : [])) : prompts.filter(prompt => prompt['enabled'] !== false)
    for (const prompt of chosen) {
      const content = text(prompt['content'])
      if (prompt['marker'] === true || content === '') continue
      const title = text(prompt['name'])
      pieces.push(`${title === '' ? '' : `[${title}]\n`}${content.slice(0, MAX_PIECE_CHARS)}`)
    }
  } else {
    for (const key of LEGACY_KEYS) if (text(root[key]) !== '') pieces.push(`[${key}]\n${text(root[key]).slice(0, MAX_PIECE_CHARS)}`)
  }
  if (pieces.length === 0) throw new ImportCardError('the file holds no instructions this importer can read: a preset has a "prompts" list with texts in it')
  const title = text(root['name']) || text(root['preset_name'])
  return { name: title === '' ? name.replace(/\.json$/i, '') : title, pieces: pieces.slice(0, MAX_PIECES) }
}
