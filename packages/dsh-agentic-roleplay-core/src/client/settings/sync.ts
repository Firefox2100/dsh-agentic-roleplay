import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_SYNC, type SyncConfig } from '../../shared/sync.ts'
import { CREDENTIAL_REF } from '../../shared/catalogue.ts'

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function syncOf(value: unknown): SyncConfig {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const minutes = typeof row['intervalMinutes'] === 'number' && Number.isFinite(row['intervalMinutes']) ? Math.max(0, Math.floor(row['intervalMinutes'])) : 0
  return { remote: text(row['remote']), rclone: text(row['rclone']), configFile: text(row['configFile']), passwordRef: text(row['passwordRef']), intervalMinutes: minutes }
}

/** The draft of the sync settings is their JSON text; it is only ever written by this form. */
export function syncFromDraft(draft: string): SyncConfig {
  try { return syncOf(JSON.parse(draft === '' ? '{}' : draft)) } catch { return { ...DEFAULT_SYNC } }
}

export function syncDraftOf(draft: string): { config: SyncConfig; intervalText: string } {
  try {
    const value = JSON.parse(draft === '' ? '{}' : draft) as unknown
    const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
    const intervalText = typeof row['intervalMinutes'] === 'string' || typeof row['intervalMinutes'] === 'number' ? String(row['intervalMinutes']) : '0'
    return { config: syncOf(value), intervalText }
  } catch {
    return { config: { ...DEFAULT_SYNC }, intervalText: '0' }
  }
}

export type SyncProblem = 'remote' | 'config' | 'keyName' | 'interval'

/** What stops the settings from being saved; sync that is off (no remote) has none. */
export function syncProblem(config: SyncConfig, intervalText: string): SyncProblem | undefined {
  if (intervalText.trim() !== '' && !/^\d+$/.test(intervalText.trim())) return 'interval'
  if (config.remote.trim() === '') return undefined
  if (!/^[^\s]+$/.test(config.remote.trim())) return 'remote'
  if (config.configFile.trim() === '' || !(config.configFile.trim().startsWith('/') || config.configFile.trim().startsWith('~/') || /^[A-Za-z]:[\\/]/.test(config.configFile.trim()))) return 'config'
  if (config.passwordRef.trim() !== '' && !CREDENTIAL_REF.test(config.passwordRef.trim())) return 'keyName'
  return undefined
}

export const syncField: SettingsFieldSpec = {
  field: 'sync',
  format: value => JSON.stringify(syncOf(value)),
  parse: (draft) => {
    const { config, intervalText } = syncDraftOf(draft)
    if (syncProblem(config, intervalText) !== undefined) return undefined
    const intervalMinutes = Number(intervalText.trim())
    const empty = config.remote === '' && config.rclone === '' && config.configFile === '' && config.passwordRef === '' && intervalMinutes === 0
    return empty ? { kind: 'clear' } : { kind: 'set', value: { remote: config.remote.trim(), rclone: config.rclone.trim(), configFile: config.configFile.trim(), passwordRef: config.passwordRef.trim(), intervalMinutes } }
  },
}
