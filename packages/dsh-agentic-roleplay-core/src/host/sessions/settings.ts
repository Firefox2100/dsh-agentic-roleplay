import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, parseSettings, type ChatSettings } from '../../shared/settings.ts'

export const SETTINGS_FILE = 'settings.json'

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
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(parsed.value, null, 2)}\n`)
  renameSync(temporary, file)
  return parsed.value
}
