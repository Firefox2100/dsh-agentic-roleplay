import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface UnitRecord {
  /** The revision of the remote copy this device last synced with. */
  base?: string
  /** What the local folder looked like right after that sync. */
  fingerprint?: string
  /** True once bisync has a baseline for the unit. */
  ready?: boolean
  at?: string
  failed?: string
  /** A choice is waiting: the whole unit differs on both sides, the first run found two different copies, it was removed here but is on the remote, or another device deleted it. */
  diverged?: 'both' | 'first' | 'removed' | 'deleted'
  /** The files were replaced but the chat could not be made again from them; the next run tries again. */
  chat?: 'stale'
}

export interface SyncStore {
  device: string
  lastRun?: string
  units: Record<string, UnitRecord>
  /** Units this device deleted; a run does not bring them back from the remote. */
  ignored: string[]
}

export const syncFolder = (root: string): string => join(root, '.sync')

/** What this device remembers about its syncing; it lives beside the root's content but is never a unit, so it is never synced. */
export function readStore(root: string): SyncStore {
  try {
    const parsed = JSON.parse(readFileSync(join(syncFolder(root), 'state.json'), 'utf8')) as Partial<SyncStore>
    return { device: parsed.device ?? randomUUID(), ...(parsed.lastRun === undefined ? {} : { lastRun: parsed.lastRun }), units: parsed.units ?? {}, ignored: parsed.ignored ?? [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { device: randomUUID(), units: {}, ignored: [] }
  }
}

export function writeStore(root: string, store: SyncStore): void {
  const folder = syncFolder(root)
  mkdirSync(folder, { recursive: true })
  const temporary = join(folder, `state.json.${process.pid}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`)
  renameSync(temporary, join(folder, 'state.json'))
}
