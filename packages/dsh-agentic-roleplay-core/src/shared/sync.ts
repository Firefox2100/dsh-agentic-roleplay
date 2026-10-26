/** How rclone is reached and where the roleplay content is kept; empty `remote` means sync is off. */
export interface SyncConfig {
  /** The rclone remote and folder the content goes to, as rclone writes it (`name:folder`). */
  remote: string
  /** The rclone executable; empty looks for `rclone` on the PATH. */
  rclone: string
  /** The rclone configuration file. It must be outside the roleplay root. */
  configFile: string
  /** The credential holding the password of an encrypted configuration file; empty uses the name `ROLEPLAY_SYNC_RCLONE_CONFIG_PASS`. */
  passwordRef: string
  /** Minutes between automatic runs; 0 syncs only when asked. */
  intervalMinutes: number
}

export const DEFAULT_SYNC: SyncConfig = { remote: '', rclone: '', configFile: '', passwordRef: '', intervalMinutes: 0 }

export const SYNC_PASSWORD_REF = 'ROLEPLAY_SYNC_RCLONE_CONFIG_PASS'

export type SyncKind = 'world' | 'session' | 'shared'

/** What one unit is in now: `ignored` was deleted here on purpose and is not brought back; `synced` is as of its last run; `new` was never synced; `changed` differs from the last run; `conflict` needs a choice. */
export type SyncState = 'synced' | 'changed' | 'conflict' | 'busy' | 'failed' | 'new' | 'ignored'

export interface SyncUnitStatus {
  /** The unit's path under the root, for example `worlds/blackwater` or `sessions/<uuid>`. */
  id: string
  kind: SyncKind
  state: SyncState
  /** When the unit last finished a run, as an ISO instant. */
  at?: string
  /** What happened or what stands in the way. */
  message?: string
  /** For a conflict: the files both sides changed, or empty when the whole unit differs. */
  conflicts?: string[]
  /** For a choice that is about a deletion: `removed` was deleted here and still exists on the remote, `deleted` was deleted on another device and changed here. */
  removal?: 'removed' | 'deleted'
}

export interface SyncStatus {
  /** Why sync cannot run, if it cannot. */
  problem?: string
  running: boolean
  lastRun?: string
  units: SyncUnitStatus[]
}

export type SyncSide = 'local' | 'remote'

export interface SyncRunResult {
  units: SyncUnitStatus[]
}

export const SYNC_CHANGED = 'roleplay-sync-changed'
