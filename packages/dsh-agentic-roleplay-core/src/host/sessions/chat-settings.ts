import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, sessionFolder } from 'dsh-roleplay-state'
import { MAX_ROUNDS, MIN_ROUNDS, type SettingsPayload } from '../../shared/settings.ts'
import { SessionNotFoundError } from './errors.ts'
import { readSettings, writeSettings } from './settings.ts'

export interface ChatSettingsDeps {
  sessionsDir: () => string
}

const LIMITS = { minRounds: MIN_ROUNDS, maxRounds: MAX_ROUNDS }

function folderOf(deps: ChatSettingsDeps, id: string): string {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  return sessionFolder(directory, id)
}

/**
 * The settings of a session.
 * @throws {SessionNotFoundError} when the id names no session.
 * @throws {InvalidSettingsError} when its settings file is not valid.
 */
export function readChatSettings(deps: ChatSettingsDeps, id: string): SettingsPayload {
  return { settings: readSettings(folderOf(deps, id)), limits: LIMITS }
}

/**
 * Replace the settings of a session.
 * @throws {SessionNotFoundError} when the id names no session.
 * @throws {InvalidSettingsError} when the value is not acceptable; nothing is stored then.
 */
export function writeChatSettings(deps: ChatSettingsDeps, id: string, value: unknown): SettingsPayload {
  return { settings: writeSettings(folderOf(deps, id), value), limits: LIMITS }
}
