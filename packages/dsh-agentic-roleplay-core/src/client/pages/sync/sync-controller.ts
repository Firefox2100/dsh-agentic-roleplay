import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SyncSide, SyncStatus } from '../../../shared/sync.ts'
import { forgetSync, loadSyncStatus, resolveSync, restoreSync, runSync } from '../../sync-api.ts'

export interface SyncState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  /** A run or a choice this page started is under way. */
  working: boolean
  sync?: SyncStatus
  /** Message of the last failure of a read, a run or a choice; the next success clears it. */
  error?: string
}

export interface SyncFace {
  hooks: { sync: SnapshotStore<SyncState> }
  load: () => void
  refresh: () => void
  /** Syncs everything, or only the named unit. */
  run: (unit?: string) => void
  resolve: (unit: string, side: SyncSide) => void
  /** Stops syncing a unit that was deleted here, leaving the remote's copy. */
  forget: (unit: string) => void
  /** Syncs a unit that was forgotten again. */
  restore: (unit: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Reads what the sync knows of each unit and starts runs and choices; while one runs the page keeps reading. */
export class SyncController {
  readonly store = createSnapshotStore<SyncState>({ status: 'idle', working: false })
  private readonly abort = new AbortController()
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly face: SyncFace = {
    hooks: { sync: this.store },
    load: () => { if (this.store.getSnapshot().status === 'idle') void this.read(true) },
    refresh: () => { void this.read(false) },
    run: (unit) => { void this.work(() => runSync(unit === undefined ? undefined : [unit], this.abort.signal)) },
    resolve: (unit, side) => { void this.work(() => resolveSync(unit, side, this.abort.signal)) },
    forget: (unit) => { void this.work(() => forgetSync(unit, this.abort.signal)) },
    restore: (unit) => { void this.work(() => restoreSync(unit, this.abort.signal)) },
  }

  inject(): SyncFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
    this.stopPolling()
  }

  private async work(action: () => Promise<unknown>): Promise<void> {
    if (this.store.getSnapshot().working) return
    this.store.update((draft) => { draft.working = true; delete draft.error })
    this.timer ??= setInterval(() => { void this.read(false) }, 2000)
    try {
      await action()
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error) })
    } finally {
      this.stopPolling()
      if (!this.abort.signal.aborted) {
        this.store.update((draft) => { draft.working = false })
        await this.read(false)
      }
    }
  }

  private stopPolling(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  private async read(first: boolean): Promise<void> {
    if (first) this.store.update((draft) => { draft.status = 'loading' })
    try {
      const sync = await loadSyncStatus(this.abort.signal)
      this.store.update((draft) => { draft.status = 'ready'; draft.sync = sync })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.sync === undefined) draft.status = 'failed' })
    }
  }
}
