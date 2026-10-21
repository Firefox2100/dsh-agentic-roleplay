import { ImportCardError } from './card.ts'
import { MAX_PREVIEW_TEXT, type SelectionItem, type SelectionPreview } from '../../shared/import-selection.ts'
import { SAMPLING_RANGES, type StorySampling } from '../../shared/sampling.ts'
import { cleanText } from './items.ts'

/** A narration preset: the instruction texts of a SillyTavern prompt preset, in the order it sends them. */
export interface Preset {
  name: string
  pieces: string[]
  /** What the file asks of the sampling, as controls of a story. */
  sampling: StorySampling
}

/** One prompt of a preset, in the order the preset sends it. */
export interface PresetPrompt {
  id: string
  title: string
  role: string
  /** The text as written, macros and all. */
  content: string
  /** Whether the preset sends it. */
  on: boolean
  /** The prompt as the file holds it. */
  raw: Json
}

/** The older preset layout keeps its texts under fixed keys. */
const LEGACY_KEYS = ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt', 'impersonation_prompt', 'new_chat_prompt', 'new_group_chat_prompt', 'new_example_chat_prompt'] as const

const MAX_PIECES = 60
const MAX_PIECE_CHARS = 8000

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Prompts sent as the model's own turn are prefills for one particular model, not instructions. */
const PREFILL_ROLES = ['assistant', 'model']

/** The text of the macro that opens at `from` (just after its `{{`), up to its matching `}}`, or undefined when it never closes. */
function macroEnd(source: string, from: number): number | undefined {
  let depth = 1
  for (let at = from; at < source.length - 1; at += 1) {
    if (source.startsWith('{{', at)) { depth += 1; at += 1 } else if (source.startsWith('}}', at)) { depth -= 1; if (depth === 0) return at; at += 1 }
  }
  return undefined
}

/** Splits a macro's inside at its `::`, leaving the macros nested in an argument whole. */
function macroParts(inside: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < inside.length; at += 1) {
    if (inside.startsWith('{{', at)) { depth += 1; at += 1 } else if (inside.startsWith('}}', at)) { depth -= 1; at += 1 } else if (depth === 0 && inside.startsWith('::', at)) { parts.push(inside.slice(start, at)); start = at + 2; at += 1 }
  }
  return [...parts, inside.slice(start)]
}

/**
 * Plays the variable macros of a preset (`setvar`, `addvar`, `getvar`), drops its comments and `trim` markers and shows a `random` as all its choices, so that a text reads as it will to the model.
 * The variables belong to the whole preset: a prompt early in the order may set what a later one reads.
 */
export function resolveMacros(source: string, variables: Map<string, string>): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = source.indexOf('{{', at)
    const close = open === -1 ? undefined : macroEnd(source, open + 2)
    if (open === -1 || close === undefined) return out + source.slice(at)
    out += source.slice(at, open)
    const parts = macroParts(source.slice(open + 2, close))
    const name = (parts[0] ?? '').trim()
    const args = parts.slice(1).map(part => resolveMacros(part, variables))
    if (name.startsWith('//') || name.toLowerCase() === 'trim') out += ''
    else if (name === 'setvar' || name === 'setglobalvar') variables.set(args[0] ?? '', args.slice(1).join('::'))
    else if (name === 'addvar' || name === 'addglobalvar') variables.set(args[0] ?? '', `${variables.get(args[0] ?? '') ?? ''}${args.slice(1).join('::')}`)
    else if (name === 'getvar' || name === 'getglobalvar') out += variables.get(args[0] ?? '') ?? ''
    else if (name === 'random') out += args.join(' / ')
    else out += source.slice(open, close + 2)
    at = close + 2
  }
}

/** The order the preset sends its prompts in: the longest list it gives, with what each entry says about being on. */
function orderOf(root: Json): { identifier: string; enabled: boolean }[] {
  const lists = Array.isArray(root['prompt_order']) ? root['prompt_order'].flatMap(entry => (isObject(entry) && Array.isArray(entry['order']) ? [entry['order']] : [])) : []
  const longest = lists.sort((a, b) => b.length - a.length)[0] ?? []
  return longest.flatMap((entry) => (isObject(entry) && typeof entry['identifier'] === 'string' ? [{ identifier: entry['identifier'], enabled: entry['enabled'] !== false }] : []))
}

/** The sampling fields of a preset file and the control of a story each sets; a value that leaves the choice to the server is not carried. */
const SAMPLING_FIELDS = { top_p: 'topP', top_k: 'topK', min_p: 'minP', frequency_penalty: 'frequencyPenalty', presence_penalty: 'presencePenalty', repetition_penalty: 'repetitionPenalty' } as const

/** What the file asks of the model's sampling. The one temperature is asked of the narrator and of the characters. */
function samplingOf(root: Json): StorySampling {
  const sampling: Record<string, number> = {}
  const within = (key: keyof StorySampling, value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const { min, max } = SAMPLING_RANGES[key]
    return value < min || value > max ? undefined : value
  }
  const temperature = within('master', root['temperature'])
  if (temperature !== undefined) { sampling['master'] = temperature; sampling['characters'] = temperature }
  for (const [field, key] of Object.entries(SAMPLING_FIELDS)) {
    const value = within(key, root[field])
    if (value !== undefined && value !== SAMPLING_RANGES[key].neutral) sampling[key] = value
  }
  return sampling
}

function parseRoot(file: Buffer): Json {
  let root: unknown
  try { root = JSON.parse(file.toString('utf8').replace(/^\uFEFF/, '')) } catch { throw new ImportCardError('the file is not JSON: a preset is the .json file SillyTavern exports') }
  if (!isObject(root)) throw new ImportCardError('the file is not a preset: it must be a JSON object')
  return root
}

/**
 * The prompts of a preset in the order it sends them, those it has switched off included, without the markers that stand for chat history or a card's fields.
 * Prompts the order never names are not sent by the tool that wrote it and are not offered.
 */
export function promptsOf(root: Json): PresetPrompt[] {
  const prompts = Array.isArray(root['prompts']) ? root['prompts'].filter(isObject) : []
  const found: PresetPrompt[] = []
  const add = (prompt: Json, on: boolean): void => {
    const id = text(prompt['identifier'])
    if (id === '' || prompt['marker'] === true || text(prompt['content']) === '' || found.some(entry => entry.id === id)) return
    found.push({ id, title: text(prompt['name']), role: text(prompt['role']), content: text(prompt['content']), on, raw: prompt })
  }
  if (prompts.length === 0) {
    for (const key of LEGACY_KEYS) if (text(root[key]) !== '') add({ identifier: key, name: key, role: 'system', content: root[key] }, true)
    return found
  }
  const byId = new Map(prompts.flatMap(prompt => (typeof prompt['identifier'] === 'string' ? [[prompt['identifier'], prompt] as const] : [])))
  const ordered = orderOf(root)
  if (ordered.length === 0) { for (const prompt of prompts) add(prompt, prompt['enabled'] !== false); return found }
  for (const entry of ordered) { const prompt = byId.get(entry.identifier); if (prompt !== undefined) add(prompt, entry.enabled) }
  return found
}

const isPrefill = (prompt: PresetPrompt): boolean => PREFILL_ROLES.includes(prompt.role)

/**
 * Reads a preset file. Markers (places where chat history or the card's fields are inserted), switched-off prompts, prefills and empty ones are left out; the macros of the tool that wrote it are played, so that a text holds what it will say.
 * @throws {ImportCardError} when the file is not a preset, with why.
 */
export function readPreset(file: Buffer, name: string): Preset {
  const root = parseRoot(file)
  const pieces: string[] = []
  const variables = new Map<string, string>()
  for (const prompt of promptsOf(root)) {
    if (!prompt.on || isPrefill(prompt)) continue
    const content = cleanText(resolveMacros(prompt.content, variables), 'the character')
    if (content === '') continue
    pieces.push(`${prompt.title === '' ? '' : `[${prompt.title}]\n`}${content.slice(0, MAX_PIECE_CHARS)}`)
  }
  if (pieces.length === 0) throw new ImportCardError('the file holds no instructions this importer can read: a preset has a "prompts" list with texts in it')
  const title = text(root['name']) || text(root['preset_name'])
  return { name: title === '' ? name.replace(/\.json$/i, '') : title, pieces: pieces.slice(0, MAX_PIECES), sampling: samplingOf(root) }
}

/** The scripts a preset carries for the tool that wrote it (regular expressions run over replies, helper scripts), which nothing here runs. */
function scriptsOf(root: Json): NonNullable<SelectionPreview['ignored']> {
  const extensions = isObject(root['extensions']) ? root['extensions'] : {}
  const regex = Array.isArray(extensions['regex_scripts']) ? extensions['regex_scripts'].length : 0
  const helper = isObject(extensions['tavern_helper']) && Array.isArray(extensions['tavern_helper']['scripts']) ? extensions['tavern_helper']['scripts'].length : 0
  return { ...(regex === 0 ? {} : { regexScripts: regex }), ...(helper === 0 ? {} : { scripts: helper }) }
}

/** What a preset file offers, for the person to choose from. @throws {ImportCardError} when the file is not a preset. */
export function previewPreset(file: Buffer, name: string): { name: string; items: SelectionItem[]; sampling: StorySampling; ignored: NonNullable<SelectionPreview['ignored']> } {
  const root = parseRoot(file)
  const items = promptsOf(root).map((prompt): SelectionItem => ({
    id: prompt.id, title: prompt.title === '' ? prompt.id : prompt.title, detail: prompt.role, text: prompt.content.slice(0, MAX_PREVIEW_TEXT), chars: prompt.content.length, enabled: prompt.on && !isPrefill(prompt), usable: !isPrefill(prompt),
    ...(isPrefill(prompt) ? { note: 'prefill' as const } : /\{\{\s*(?:set|add)(?:global)?var::/.test(prompt.content) ? { note: 'variables' as const } : {}),
  }))
  if (items.length === 0) throw new ImportCardError('the file holds no instructions this importer can read: a preset has a "prompts" list with texts in it')
  const title = text(root['name']) || text(root['preset_name'])
  return { name: title === '' ? name.replace(/\.json$/i, '') : title, items, sampling: samplingOf(root), ignored: scriptsOf(root) }
}

/**
 * The file with only the chosen prompts in it, in the order the preset sends them, as if the preset never had the others; the sampling stays only when asked.
 * @throws {ImportCardError} when a chosen prompt is not in the file or nothing usable is chosen.
 */
export function selectPrompts(file: Buffer, enabled: readonly string[], keepSampling: boolean): Buffer {
  const root = parseRoot(file)
  const prompts = promptsOf(root)
  const unknown = enabled.filter(id => !prompts.some(prompt => prompt.id === id))
  if (unknown.length > 0) throw new ImportCardError(`the preset has no prompt ${unknown.map(id => `"${id}"`).join(', ')}`)
  const chosen = prompts.filter(prompt => enabled.includes(prompt.id) && !isPrefill(prompt))
  if (chosen.length === 0) throw new ImportCardError('choose at least one prompt of the preset')
  const kept: Json = { ...(typeof root['name'] === 'string' ? { name: root['name'] } : typeof root['preset_name'] === 'string' ? { preset_name: root['preset_name'] } : {}) }
  if (keepSampling) for (const field of ['temperature', ...Object.keys(SAMPLING_FIELDS)]) if (root[field] !== undefined) kept[field] = root[field]
  kept['prompts'] = chosen.map(prompt => prompt.raw)
  kept['prompt_order'] = [{ character_id: 100001, order: chosen.map(prompt => ({ identifier: prompt.id, enabled: true })) }]
  return Buffer.from(JSON.stringify(kept))
}
