import { existsSync } from 'node:fs'
import type { ClockMode } from 'dsh-roleplay-model'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import type { ActivityEntry } from '../../shared/activity.ts'
import type { VectorStatus } from '../../shared/vectors.ts'
import { SETTINGS_SPEC, parseSettings, type SettingsPayload } from '../../shared/settings.ts'
import { SessionNotFoundError } from './errors.ts'
import { InvalidSettingsError, readSettings, writeSettings } from './settings.ts'

export interface ChatSettingsDeps {
  sessionsDir: () => string
  /** How many recorded rounds of the session are not yet written into its records. */
  pendingRecords: (id: string) => number
  pendingConsolidation: (id: string) => number
  activity: (id: string) => ActivityEntry[]
  vectors: (id: string) => VectorStatus
  /** The mode the session's clock is in, once it has one. */
  clockMode: (id: string) => ClockMode | undefined
}

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
  return payloadOf(deps, id, readSettings(folderOf(deps, id)))
}

/**
 * Replace the settings of a session.
 * @throws {SessionNotFoundError} when the id names no session.
 * @throws {InvalidSettingsError} when the value is not acceptable; nothing is stored then.
 */
export function writeChatSettings(deps: ChatSettingsDeps, id: string, value: unknown): SettingsPayload {
  const folder = folderOf(deps, id)
  const parsed = parseSettings(value)
  if (parsed.ok && parsed.value.clock.mode === 'real' && deps.clockMode(id) === 'simulated') {
    throw new InvalidSettingsError(['"clock.mode" cannot be real: the story\'s time is simulated and has its own dates, so it cannot follow the real clock'])
  }
  return payloadOf(deps, id, writeSettings(folder, value))
}

function payloadOf(deps: ChatSettingsDeps, id: string, settings: SettingsPayload['settings']): SettingsPayload {
  const clockMode = deps.clockMode(id)
  return { settings, bounds: SETTINGS_SPEC, pendingRecords: deps.pendingRecords(id), pendingConsolidation: deps.pendingConsolidation(id), activity: deps.activity(id), vectors: deps.vectors(id), ...(clockMode === undefined ? {} : { clockMode }) }
}
