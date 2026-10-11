import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createAvatar, deleteAvatar, listAvatars, type AvatarSummary } from '../../avatars-api.ts'

export interface AvatarsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  avatars?: AvatarSummary[]
  /** Message of the last failed read; a later success clears it. */
  error?: string
}

export interface AvatarsFace {
  hooks: { avatars: SnapshotStore<AvatarsState> }
  load: () => void
  refresh: () => void
  /** Makes an avatar; rejects with the host's reason. @returns its key. */
  create: (name: string) => Promise<string>
  remove: (key: string) => Promise<void>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Reads the player avatars from the host and makes and removes them. */
export class AvatarsController {
  readonly store = createSnapshotStore<AvatarsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly face: AvatarsFace = {
    hooks: { avatars: this.store },
    load: () => { if (this.store.getSnapshot().status === 'idle') void this.read(false) },
    refresh: () => { void this.read(true) },
    create: async (name) => { const key = await createAvatar(name, this.abort.signal); await this.read(true); return key },
    remove: async (key) => { await deleteAvatar(key, this.abort.signal); await this.read(true) },
  }

  inject(): AvatarsFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
  }

  private async read(refreshing: boolean): Promise<void> {
    this.store.update((draft) => { if (refreshing) draft.refreshing = true; else draft.status = 'loading' })
    try {
      const avatars = await listAvatars(this.abort.signal)
      this.store.update((draft) => { draft.status = 'ready'; draft.avatars = avatars; delete draft.error })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.avatars === undefined) draft.status = 'failed' })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
