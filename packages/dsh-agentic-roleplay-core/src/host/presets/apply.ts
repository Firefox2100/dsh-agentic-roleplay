import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PresetState, PresetStatus } from '../../shared/presets.ts'
import { PROMPTS_FOLDER } from '../prompts/library.ts'
import { listPresets, loadPreset, sha, type LoadedPreset } from './presets.ts'

/** Which preset a story's prompts came from, and what each copied file held: kept beside the story's database, so that a story can tell its copies from its own edits. */
export const PRESET_RECORD = 'preset.json'

interface Record_ {
  name: string
  files: Record<string, string>
}

const promptFile = (folder: string, path: string): string => join(folder, PROMPTS_FOLDER, ...path.split('/'))

function readRecord(folder: string): Record_ | undefined {
  const file = join(folder, PRESET_RECORD)
  if (!existsSync(file)) return undefined
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error(`${file} is damaged`) }
  const { name, files } = (value ?? {}) as { name?: unknown; files?: unknown }
  if (typeof name !== 'string' || typeof files !== 'object' || files === null || !Object.values(files).every(hash => typeof hash === 'string')) throw new Error(`${file} is damaged`)
  return { name, files: files as Record<string, string> }
}

function writeRecord(folder: string, record: Record_ | undefined): void {
  const file = join(folder, PRESET_RECORD)
  if (record === undefined) { rmSync(file, { force: true }); return }
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(record, null, 2))
  renameSync(temporary, file)
}

/** Writes the preset's prompts over the story's own. */
export function copyPreset(preset: LoadedPreset, folder: string): void {
  for (const [path, text] of preset.files) {
    const to = promptFile(folder, path)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, text)
  }
}

/** Notes that the story's prompts came from the preset: only the files that still hold the preset's text count, because the world's own may have replaced the rest. */
export function recordPreset(folder: string, preset: LoadedPreset): void {
  const files: Record<string, string> = {}
  for (const [path, text] of preset.files) {
    const own = promptFile(folder, path)
    if (existsSync(own) && readFileSync(own, 'utf8') === text) files[path] = sha(text)
  }
  writeRecord(folder, { name: preset.summary.name, files })
}

/** Where the story stands against the library. */
export function presetStatus(root: string, folder: string): PresetStatus {
  const available = listPresets(root).map(entry => entry.summary)
  const record = readRecord(folder)
  if (record === undefined) return { available }
  const paths = Object.keys(record.files)
  const edited = paths.some((path) => { const file = promptFile(folder, path); return !existsSync(file) || sha(readFileSync(file, 'utf8')) !== record.files[path] })
  let state: PresetState = edited ? 'edited' : 'current'
  try {
    const library = loadPreset(root, record.name)
    if (!edited && (library.files.size !== paths.length || paths.some(path => { const text = library.files.get(path); return text === undefined || sha(text) !== record.files[path] }))) state = 'changed'
  } catch { state = 'missing' }
  return { applied: { name: record.name, state, files: paths }, available }
}

/**
 * Takes the story's copies of its preset out (to `.trash/prompts/` in the story) and, when a preset is named, puts that one in.
 * Prompts the world carried that a preset had replaced are not brought back.
 * @returns the files that were replaced or taken out.
 * @throws {Error} when the named preset has problems or does not exist; nothing is changed then.
 */
export function switchPreset(root: string, folder: string, name: string | undefined, now: () => number = Date.now): string[] {
  const next = name === undefined ? undefined : loadPreset(root, name)
  if (next !== undefined && next.summary.problems.length > 0) throw new Error(`the preset "${name}" has problems: ${next.summary.problems.join('; ')}`)
  const record = readRecord(folder)
  const touched = new Set<string>(next === undefined ? [] : next.files.keys())
  for (const path of Object.keys(record?.files ?? {})) touched.add(path)
  const aside = join(folder, '.trash', PROMPTS_FOLDER, String(now()))
  const moved: string[] = []
  for (const path of touched) {
    const file = promptFile(folder, path)
    if (!existsSync(file)) continue
    const to = join(aside, ...path.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file, to)
    moved.push(path)
  }
  for (const path of Object.keys(record?.files ?? {})) { const file = promptFile(folder, path); rmSync(file, { force: true }) }
  if (next === undefined) { writeRecord(folder, undefined); return moved }
  copyPreset(next, folder)
  recordPreset(folder, next)
  return moved
}

/** A branch plays with the preset of the story it was cut from. */
export function inheritPreset(from: string, to: string): void {
  const file = join(from, PRESET_RECORD)
  if (existsSync(file)) copyFileSync(file, join(to, PRESET_RECORD))
}
