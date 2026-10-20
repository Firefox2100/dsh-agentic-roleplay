import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LORE_KINDS, LORE_SCOPES, type LoreDefinition } from 'dsh-roleplay-model'
import type { LorebookEntry, LorebookSummary } from '../../shared/lorebooks.ts'
import { loadLore, LORE_DIR, MAX_LORE } from '../lore/load.ts'
import { LORE_FILE_NAME, parseLoreFile } from '../lore/lore-file.ts'

export const LOREBOOKS_FOLDER = 'lorebooks'
export const LOREBOOK_FILE = 'lorebook.json'
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENTRY_ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u
const MAX_TEXT = 300

export const isLorebookName = (name: string): boolean => NAME.test(name)
export const isEntryId = (id: string): boolean => ENTRY_ID.test(id)

export const lorebooksDirectory = (root: string): string => join(root, LOREBOOKS_FOLDER)

export function lorebookDirectory(root: string, name: string): string {
  if (!isLorebookName(name)) throw new Error(`"${name}" is not a usable lorebook name (letters, digits, "-" and "_", up to 64)`)
  return join(lorebooksDirectory(root), name)
}

/** A lorebook as read: what it says about itself and its entries, in the format of a world's own lore. */
export interface LoadedLorebook {
  summary: LorebookSummary
  entries: LoreDefinition[]
}

interface Header { title?: string; description?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function parseHeader(value: unknown, problems: string[]): Header {
  if (!isRecord(value)) { problems.push(`${LOREBOOK_FILE} must be an object`); return {} }
  const text = (key: string): string | undefined => {
    const field = value[key]
    if (field === undefined || field === null) return undefined
    if (typeof field !== 'string' || field.length > MAX_TEXT) { problems.push(`${LOREBOOK_FILE}: "${key}" must be text of at most ${MAX_TEXT} characters`); return undefined }
    return field.trim() || undefined
  }
  const title = text('title'); const description = text('description')
  return { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }) }
}

function readHeader(directory: string, problems: string[]): Header {
  const file = join(directory, LOREBOOK_FILE)
  if (!existsSync(file)) return {}
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) } catch { problems.push(`${LOREBOOK_FILE} is not valid JSON`); return {} }
  return parseHeader(value, problems)
}

/** What is wrong with the entries of a book as a whole: an entry about a character or place of some world, or relating to one that is not there. */
export function bookProblems(entries: readonly LoreDefinition[]): string[] {
  const ids = new Set(entries.map(entry => entry.id))
  return entries.flatMap(entry => [
    ...(entry.subjects.length > 0 ? [`${entry.id}: a lorebook does not belong to a world, so its entries have no subjects`] : []),
    ...entry.related.flatMap(other => other === entry.id ? [`${entry.id}: related: an entry cannot relate to itself`] : ids.has(other) ? [] : [`${entry.id}: related: "${other}" is not an entry of this book`]),
  ])
}

/** Reads one lorebook folder, collecting every problem instead of stopping at the first. @throws {Error} when the folder does not exist. */
export async function readLorebook(directory: string, name: string): Promise<LoadedLorebook> {
  if (!existsSync(directory)) throw new Error(`there is no lorebook "${name}"`)
  const problems: string[] = []
  const header = readHeader(directory, problems)
  const { lore, problems: found } = await loadLore(directory)
  for (const problem of found) problems.push(`${problem.path.slice(directory.length + 1)}: ${problem.message}`)
  problems.push(...bookProblems(lore))
  if (lore.length === 0 && problems.length === 0) problems.push('the lorebook has no entries')
  return {
    summary: { name, title: header.title ?? name, description: header.description ?? '', entries: lore.length, common: lore.filter(entry => entry.scope === 'everyone').length, problems },
    entries: lore.sort((a, b) => a.title.localeCompare(b.title)),
  }
}

export async function listLorebooks(root: string): Promise<LoadedLorebook[]> {
  const folder = lorebooksDirectory(root)
  if (!existsSync(folder)) return []
  const found = (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isDirectory() && isLorebookName(entry.name))
  return (await Promise.all(found.map(entry => readLorebook(join(folder, entry.name), entry.name)))).sort((a, b) => a.summary.name.localeCompare(b.summary.name))
}

export async function loadLorebook(root: string, name: string): Promise<LoadedLorebook> {
  return await readLorebook(lorebookDirectory(root, name), name)
}

const toEntry = (definition: LoreDefinition): LorebookEntry => ({ id: definition.id, title: definition.title, kind: definition.kind, scope: definition.scope, knownBy: definition.knownBy, summary: definition.summary, body: definition.body, related: definition.related })
export const entriesOf = (book: LoadedLorebook): LorebookEntry[] => book.entries.map(toEntry)

function headerFile(header: Header): string {
  return `${JSON.stringify(header, null, 2)}\n`
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, text)
  await rename(`${file}.tmp`, file)
}

async function createFolder(root: string, name: string, header: Header, entries: readonly LorebookEntry[]): Promise<string> {
  const target = lorebookDirectory(root, name)
  if (existsSync(target)) throw new Error(`there is already a lorebook "${name}"`)
  const problems: string[] = []
  const checked = parseHeader(header, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  const staging = join(root, '.install', `lorebook-${name}-${Date.now()}`)
  try {
    await writeAtomic(join(staging, LOREBOOK_FILE), headerFile(checked))
    for (const entry of entries) await writeAtomic(join(staging, LORE_DIR, entry.id, LORE_FILE_NAME), entryFile(entry))
    const loaded = await readLorebook(staging, name)
    if (loaded.summary.problems.length > 0) throw new Error(`the lorebook would have problems: ${loaded.summary.problems.join('; ')}`)
    await mkdir(lorebooksDirectory(root), { recursive: true })
    await rename(staging, target)
    return target
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Makes an empty lorebook. @throws {Error} when the name is taken or the information is not acceptable. */
export async function createLorebook(root: string, request: { name: string; title?: string; description?: string }): Promise<LoadedLorebook> {
  const target = lorebookDirectory(root, request.name)
  if (existsSync(target)) throw new Error(`there is already a lorebook "${request.name}"`)
  const problems: string[] = []
  const header = parseHeader({ title: request.title?.trim(), description: request.description?.trim() }, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  await writeAtomic(join(target, LOREBOOK_FILE), headerFile(header))
  return await readLorebook(target, request.name)
}

/** Makes a lorebook of ready entries, all or nothing. @throws {Error} when the name is taken or the book would have problems. */
export async function createLorebookWith(root: string, request: { name: string; title?: string; description?: string }, entries: readonly LorebookEntry[]): Promise<LoadedLorebook> {
  const target = await createFolder(root, request.name, { ...(request.title === undefined || request.title.trim() === '' ? {} : { title: request.title.trim() }), ...(request.description === undefined || request.description.trim() === '' ? {} : { description: request.description.trim() }) }, entries)
  return await readLorebook(target, request.name)
}

/** Makes an empty folder that an import is about to fill; it has no entries yet, so it reads as having problems until it does. */
export async function reserveLorebook(root: string, name: string, title: string): Promise<string> {
  const target = lorebookDirectory(root, name)
  if (existsSync(target)) throw new Error(`there is already a lorebook "${name}"`)
  await writeAtomic(join(target, LOREBOOK_FILE), headerFile({ title: title.trim().slice(0, MAX_TEXT) || name }))
  return target
}

export interface LorebookInfoChange { title?: string; description?: string }

/** Changes what a lorebook says about itself. @throws {Error} when the lorebook does not exist or the change is not acceptable; nothing is written then. */
export async function updateLorebookInfo(root: string, name: string, change: LorebookInfoChange): Promise<LoadedLorebook> {
  const directory = lorebookDirectory(root, name)
  if (!existsSync(directory)) throw new Error(`there is no lorebook "${name}"`)
  const current = readHeader(directory, [])
  const problems: string[] = []
  const next = parseHeader({ title: change.title ?? current.title, description: change.description ?? current.description }, problems)
  if (problems.length > 0) throw new Error(problems.join('; '))
  await writeAtomic(join(directory, LOREBOOK_FILE), headerFile(next))
  return await readLorebook(directory, name)
}

/** The file of an entry: written in the format of a world's own lore, with its scope always said. */
export function entryFile(entry: LorebookEntry): string {
  return `${JSON.stringify({ title: entry.title, kind: entry.kind, scope: entry.scope, ...(entry.scope === 'listed' && entry.knownBy.length > 0 ? { known_by: entry.knownBy } : {}), summary: entry.summary, body: entry.body, ...(entry.related.length > 0 ? { related: entry.related } : {}) }, null, 2)}\n`
}

/** Checks an entry the way a story start would, before anything is written. @returns why it cannot be used, or nothing. */
export function entryProblem(entry: LorebookEntry): string | undefined {
  if (!isEntryId(entry.id)) return `"${entry.id}" is not a usable entry id (letters, digits, "-" and "_", up to 80)`
  if (!LORE_KINDS.includes(entry.kind)) return `kind must be one of ${LORE_KINDS.join(', ')}`
  if (!LORE_SCOPES.includes(entry.scope)) return `scope must be one of ${LORE_SCOPES.join(', ')}`
  if (entry.title.trim() === '') return 'the entry needs a title'
  if (entry.body.trim() === '' && entry.summary.trim() === '') return 'the entry needs a summary or a body'
  const parsed = parseLoreFile(entryFile({ ...entry, title: entry.title.trim() }), entry.id)
  return parsed.ok ? undefined : parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')
}

/** Creates or replaces one entry. @throws {Error} when the lorebook does not exist, the entry is not acceptable or the book would have more entries than a world may. */
export async function writeLorebookEntry(root: string, name: string, entry: LorebookEntry): Promise<LoadedLorebook> {
  const directory = lorebookDirectory(root, name)
  if (!existsSync(directory)) throw new Error(`there is no lorebook "${name}"`)
  const problem = entryProblem(entry)
  if (problem !== undefined) throw new Error(problem)
  const file = join(directory, LORE_DIR, entry.id, LORE_FILE_NAME)
  const book = await readLorebook(directory, name)
  if (!existsSync(file) && book.entries.length >= MAX_LORE) throw new Error(`a lorebook has at most ${MAX_LORE} entries`)
  const others = book.entries.filter(other => other.id !== entry.id)
  const missing = entry.related.filter(id => id === entry.id || !others.some(other => other.id === id))
  if (missing.length > 0) throw new Error(`related: ${missing.map(id => `"${id}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not (other) entries of this book`)
  await writeAtomic(file, entryFile({ ...entry, title: entry.title.trim() }))
  return await readLorebook(directory, name)
}

/** Moves an entry into the book's `.trash`. @throws {Error} when it does not exist or other entries relate to it. */
export async function deleteLorebookEntry(root: string, name: string, id: string, now: () => number = Date.now): Promise<LoadedLorebook> {
  const directory = lorebookDirectory(root, name)
  const folder = join(directory, LORE_DIR, id)
  if (!isEntryId(id) || !existsSync(join(folder, LORE_FILE_NAME))) throw new Error(`the lorebook "${name}" has no entry "${id}"`)
  const book = await readLorebook(directory, name)
  const citing = book.entries.filter(entry => entry.id !== id && entry.related.includes(id)).map(entry => entry.id)
  if (citing.length > 0) throw new Error(`the entries ${citing.join(', ')} relate to "${id}"; change them first`)
  const aside = join(directory, '.trash', LORE_DIR, `${id}-${now()}`)
  await mkdir(dirname(aside), { recursive: true })
  await rename(folder, aside)
  return await readLorebook(directory, name)
}

/** Moves a lorebook out of the library into `<root>/.trash/lorebooks/`. @returns where it went. */
export async function deleteLorebook(root: string, name: string, now: () => number = Date.now): Promise<string> {
  const directory = lorebookDirectory(root, name)
  if (!existsSync(directory)) throw new Error(`there is no lorebook "${name}"`)
  const aside = join(root, '.trash', LOREBOOKS_FOLDER, `${name}-${now()}`)
  await mkdir(dirname(aside), { recursive: true })
  await rename(directory, aside)
  return aside
}
