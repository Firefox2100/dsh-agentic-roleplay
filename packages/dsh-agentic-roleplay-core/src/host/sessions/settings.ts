import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, parseSettings, type ChatSettings } from '../../shared/settings.ts'
import { atomicWriteSync } from '../atomic-write.ts'

export const SETTINGS_FILE = 'settings.json'

const known = new Map<string, { modified: number; value: ChatSettings }>()

let childReasoning: () => string = () => ''

/** The thinking level helpers get when a chat's own setting is empty (the profile's choice, read at each use); returns the function that takes it back. */
export function useChildReasoning(level: () => string): () => void {
  childReasoning = level
  return () => { childReasoning = () => '' }
}

/** The settings are not acceptable; `problems` say what to fix. */
export class InvalidSettingsError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the settings are not acceptable: ${problems.join('; ')}`)
  }
}

/**
 * The settings of the session in `folder`; a session that has none yet has the defaults.
 * @throws {InvalidSettingsError} when the file exists and is not valid.
 */
export function readSettings(folder: string): ChatSettings {
  const file = join(folder, SETTINGS_FILE)
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new InvalidSettingsError([`${SETTINGS_FILE} is not valid JSON (${error instanceof Error ? error.message : String(error)})`])
  }
  const parsed = parseSettings(value)
  if (!parsed.ok) throw new InvalidSettingsError(parsed.problems)
  return parsed.value
}

/**
 * Store the settings of the session in `folder`, replacing what was there.
 * @throws {InvalidSettingsError} when the value is not acceptable; nothing is written then.
 */
export function writeSettings(folder: string, value: unknown): ChatSettings {
  const parsed = parseSettings(value)
  if (!parsed.ok) throw new InvalidSettingsError(parsed.problems)
  const file = join(folder, SETTINGS_FILE)
  // Written aside and renamed, so a reader never sees half a file.
  atomicWriteSync(file, `${JSON.stringify(parsed.value, null, 2)}\n`)
  known.delete(folder)
  return parsed.value
}

/**
 * The settings to use right now. Called before each use, so an edit to the file applies at the
 * next round, step or run without a restart; the file is parsed again only when it changed.
 * A file that is not valid is reported once through `problem` and the last good settings
 * (the defaults when there were none) stay in force, so a typo cannot stop a story in the middle.
 */
export function liveSettings(folder: string, problem: (message: string) => void = () => undefined): ChatSettings {
  const value = loadedSettings(folder, problem)
  const fallback = childReasoning()
  return value.reasoning.children === '' && fallback !== '' ? { ...value, reasoning: { ...value.reasoning, children: fallback } } : value
}

function loadedSettings(folder: string, problem: (message: string) => void): ChatSettings {
  let modified = -1
  try { modified = statSync(join(folder, SETTINGS_FILE)).mtimeMs } catch { /* no file yet: the defaults */ }
  const last = known.get(folder)
  if (last?.modified === modified) return last.value
  try {
    const value = readSettings(folder)
    known.set(folder, { modified, value })
    return value
  } catch (error) {
    if (!(error instanceof InvalidSettingsError)) throw error
    problem(`${error.message} (the last good settings stay in force)`)
    const value = last?.value ?? { ...DEFAULT_SETTINGS }
    known.set(folder, { modified, value })
    return value
  }
}
