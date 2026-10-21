import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PresetSampling, PresetSummary } from '../../shared/presets.ts'
import { parseSampling } from '../../shared/sampling.ts'
import { LANGUAGE_FOLDER, listFiles, promptProblem, PROMPTS_FOLDER, shippedLanguages, shippedPromptsDirectory } from '../prompts/library.ts'
import { PROSE_PROMPTS, readWorldPrompt } from '../prompts/world-prompts.ts'

export const PRESETS_FOLDER = 'presets'
export const PRESET_FILE = 'preset.json'
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_TEXT = 300

export const isPresetName = (name: string): boolean => NAME.test(name)

export const presetsDirectory = (root: string): string => join(root, PRESETS_FOLDER)

export function presetDirectory(root: string, name: string): string {
  if (!isPresetName(name)) throw new Error(`"${name}" is not a usable preset name (letters, digits, "-" and "_", up to 64)`)
  return join(presetsDirectory(root), name)
}

/** A preset as read: what it says about itself and its prompt files, keyed `<language>/<id>.md`. */
export interface LoadedPreset {
  summary: PresetSummary
  files: Map<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

interface Header { title?: string; description?: string; sampling: PresetSampling }

function parseHeader(value: unknown, problems: string[]): Header {
  if (!isRecord(value)) { problems.push(`${PRESET_FILE} must be an object`); return { sampling: {} } }
  const text = (key: string): string | undefined => {
    const field = value[key]
    if (field === undefined || field === null) return undefined
    if (typeof field !== 'string' || field.length > MAX_TEXT) { problems.push(`${PRESET_FILE}: "${key}" must be text of at most ${MAX_TEXT} characters`); return undefined }
    return field.trim() || undefined
  }
  const sampling = parseSampling(value['sampling'], `${PRESET_FILE}: sampling`, problems)
  const title = text('title')
  const description = text('description')
  return { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), sampling }
}

function readHeader(directory: string, problems: string[]): Header {
  const file = join(directory, PRESET_FILE)
  if (!existsSync(file)) return { sampling: {} }
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) } catch { problems.push(`${PRESET_FILE} is not valid JSON`); return { sampling: {} } }
  return parseHeader(value, problems)
}

/** Reads one preset folder, collecting every problem instead of stopping at the first. @throws {Error} when the folder does not exist. */
export function readPreset(directory: string, name: string, shipped: string = shippedPromptsDirectory()): LoadedPreset {
  if (!existsSync(directory)) throw new Error(`there is no preset "${name}"`)
  const problems: string[] = []
  const header = readHeader(directory, problems)
  const files = new Map<string, string>()
  const base = join(directory, PROMPTS_FOLDER)
  if (existsSync(base)) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !LANGUAGE_FOLDER.test(entry.name)) { problems.push(`prompts/${entry.name}: prompts are kept in a folder named by the language, such as en or zh`); continue }
      for (const id of listFiles(join(base, entry.name))) {
        const path = `${entry.name}/${id}.md`
        const text = readFileSync(join(base, path), 'utf8')
        const problem = id.startsWith('roleplay/') ? promptProblem(entry.name, id, text, shipped) : `"${id}" is not a prompt of the story`
        if (problem !== undefined) problems.push(`prompts/${path}: ${problem}`)
        else files.set(path, text)
      }
    }
  }
  if (files.size === 0 && problems.length === 0) problems.push('the preset carries no prompts')
  const paths = [...files.keys()]
  const ids = [...new Set(paths.map(path => path.slice(path.indexOf('/') + 1, -3)))].sort()
  return {
    summary: {
      name,
      title: header.title ?? name,
      description: header.description ?? '',
      languages: [...new Set(paths.map(path => path.split('/')[0] as string))].sort(),
      prompts: ids,
      rules: ids.filter(id => !PROSE_PROMPTS.includes(id)),
      sampling: header.sampling,
      problems,
    },
    files,
  }
}

/** Every preset in the library; one that cannot be read is listed with its problems. */
export function listPresets(root: string): LoadedPreset[] {
  const folder = presetsDirectory(root)
  if (!existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory() && isPresetName(entry.name)).map(entry => readPreset(join(folder, entry.name), entry.name)).sort((a, b) => a.summary.name.localeCompare(b.summary.name))
}

export function loadPreset(root: string, name: string): LoadedPreset {
  return readPreset(presetDirectory(root, name), name)
}

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Makes a preset of the prose prompts a world carries. Nothing is overwritten.
 * @throws {Error} when the name is taken, the world carries no prose prompt, or what it carries is not acceptable.
 */
export async function savePresetFromWorld(root: string, worldDirectory: string, request: { name: string; title?: string; description?: string; sampling?: PresetSampling }): Promise<LoadedPreset> {
  const target = presetDirectory(root, request.name)
  if (existsSync(target)) throw new Error(`there is already a preset "${request.name}"`)
  const source = join(worldDirectory, PROMPTS_FOLDER)
  const found: { language: string; id: string }[] = []
  if (existsSync(source)) for (const entry of readdirSync(source, { withFileTypes: true })) if (entry.isDirectory() && LANGUAGE_FOLDER.test(entry.name)) for (const id of listFiles(join(source, entry.name))) if (PROSE_PROMPTS.includes(id)) found.push({ language: entry.name, id })
  if (found.length === 0) throw new Error('the world carries no prose prompts to make a preset of')
  const staging = join(root, '.install', `preset-${request.name}-${Date.now()}`)
  try {
    for (const { language, id } of found) {
      const to = join(staging, PROMPTS_FOLDER, language, `${id}.md`)
      await mkdir(dirname(to), { recursive: true })
      await writeFile(to, readFileSync(join(source, language, `${id}.md`), 'utf8'))
    }
    const header = { ...(request.title === undefined || request.title.trim() === '' ? {} : { title: request.title.trim() }), ...(request.description === undefined || request.description.trim() === '' ? {} : { description: request.description.trim() }), ...(request.sampling === undefined || Object.keys(request.sampling).length === 0 ? {} : { sampling: request.sampling }) }
    await writeFile(join(staging, PRESET_FILE), JSON.stringify(header, null, 2))
    const loaded = readPreset(staging, request.name)
    if (loaded.summary.problems.length > 0) throw new Error(`the preset would have problems: ${loaded.summary.problems.join('; ')}`)
    await mkdir(presetsDirectory(root), { recursive: true })
    await rename(staging, target)
    return readPreset(target, request.name)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Moves a preset out of the library into `<root>/.trash/presets/`. @returns where it went. */
export async function deletePreset(root: string, name: string, now: () => number = Date.now): Promise<string> {
  const directory = presetDirectory(root, name)
  if (!existsSync(directory)) throw new Error(`there is no preset "${name}"`)
  const aside = join(root, '.trash', PRESETS_FOLDER, `${name}-${now()}`)
  await mkdir(dirname(aside), { recursive: true })
  await rename(directory, aside)
  return aside
}

export interface PresetInfoChange {
  title?: string
  description?: string
  /** Replaces the suggested temperatures as a whole; an empty object suggests none. */
  sampling?: PresetSampling
}

function headerFile(title: string | undefined, description: string | undefined, sampling: PresetSampling): string {
  return `${JSON.stringify({ ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(Object.keys(sampling).length === 0 ? {} : { sampling }) }, null, 2)}\n`
}

async function writeHeader(directory: string, text: string): Promise<void> {
  const file = join(directory, PRESET_FILE)
  await writeFile(`${file}.tmp`, text)
  await rename(`${file}.tmp`, file)
}

/** Changes what a preset says about itself. @throws {Error} when the preset does not exist or the change is not acceptable; nothing is written then. */
export async function updatePresetInfo(root: string, name: string, change: PresetInfoChange): Promise<LoadedPreset> {
  const directory = presetDirectory(root, name)
  if (!existsSync(directory)) throw new Error(`there is no preset "${name}"`)
  const current = readHeader(directory, [])
  const problems: string[] = []
  const next = parseHeader({ title: change.title ?? current.title, description: change.description ?? current.description, sampling: change.sampling ?? current.sampling }, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  await writeHeader(directory, headerFile(next.title, next.description, next.sampling))
  return readPreset(directory, name)
}

/**
 * Makes a preset holding the shipped prose prompts of every language, as a starting point to edit. Nothing is overwritten.
 * @throws {Error} when the name is taken or the information is not acceptable.
 */
export async function createPresetFromShipped(root: string, request: { name: string; title?: string; description?: string; sampling?: PresetSampling }, shipped: string = shippedPromptsDirectory()): Promise<LoadedPreset> {
  const target = presetDirectory(root, request.name)
  if (existsSync(target)) throw new Error(`there is already a preset "${request.name}"`)
  const problems: string[] = []
  const header = parseHeader({ title: request.title?.trim(), description: request.description?.trim(), sampling: request.sampling }, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  const staging = join(root, '.install', `preset-${request.name}-${Date.now()}`)
  try {
    for (const language of shippedLanguages(shipped)) {
      for (const id of PROSE_PROMPTS) {
        const from = join(shipped, language, `${id}.md`)
        if (!existsSync(from)) continue
        const to = join(staging, PROMPTS_FOLDER, language, `${id}.md`)
        await mkdir(dirname(to), { recursive: true })
        await writeFile(to, readFileSync(from, 'utf8'))
      }
    }
    await mkdir(staging, { recursive: true })
    await writeHeader(staging, headerFile(header.title, header.description, header.sampling))
    const loaded = readPreset(staging, request.name)
    if (loaded.summary.problems.length > 0) throw new Error(`the preset would have problems: ${loaded.summary.problems.join('; ')}`)
    await mkdir(presetsDirectory(root), { recursive: true })
    await rename(staging, target)
    return readPreset(target, request.name)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Makes an empty preset folder that the import is about to fill; it has no prompts yet, so it reads as having problems until it does. */
export async function reservePreset(root: string, name: string, title: string, sampling: PresetSampling = {}): Promise<string> {
  const target = presetDirectory(root, name)
  if (existsSync(target)) throw new Error(`there is already a preset "${name}"`)
  await mkdir(target, { recursive: true })
  await writeHeader(target, headerFile(title.trim().slice(0, MAX_TEXT) || undefined, undefined, sampling))
  return target
}

/**
 * Makes a preset that adds guidance to the shipped prompts, in every language the program ships: each prompt keeps its shipped text and the guidance follows it, so that
 * the prompt keeps naming the tools and values it needs. The guidance is the importer's, in the language it was written in.
 * @throws {Error} when the name is taken, there is no guidance, or a prompt would not be acceptable; nothing is made then.
 */
export async function createPresetFromGuidance(root: string, request: { name: string; title?: string; description?: string }, guidance: Readonly<Record<string, readonly string[]>>, shipped: string = shippedPromptsDirectory()): Promise<LoadedPreset> {
  const target = presetDirectory(root, request.name)
  if (existsSync(target)) throw new Error(`there is already a preset "${request.name}"`)
  const ids = Object.keys(guidance).filter(id => (guidance[id]?.length ?? 0) > 0)
  if (ids.length === 0) throw new Error('there is no guidance to make a preset of')
  const problems: string[] = []
  const header = parseHeader({ title: request.title?.trim(), description: request.description?.trim() }, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  const staging = join(root, '.install', `preset-${request.name}-${Date.now()}`)
  try {
    for (const language of shippedLanguages(shipped)) {
      for (const id of ids) {
        const base = readWorldPrompt(join(staging, 'none'), language, id, shipped).text.trimEnd()
        const to = join(staging, PROMPTS_FOLDER, language, `${id}.md`)
        await mkdir(dirname(to), { recursive: true })
        await writeFile(to, `${base}\n\n${(guidance[id] ?? []).join('\n')}\n`)
      }
    }
    await writeHeader(staging, headerFile(header.title, header.description, {}))
    const loaded = readPreset(staging, request.name)
    if (loaded.summary.problems.length > 0) throw new Error(`the preset would have problems: ${loaded.summary.problems.join('; ')}`)
    await mkdir(presetsDirectory(root), { recursive: true })
    await rename(staging, target)
    return readPreset(target, request.name)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
