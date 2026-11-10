import { createSnapshotStore, type SnapshotStore } from '../../store.ts'
import type { PromptEntry } from '../../../shared/prompts.ts'
import { listPrompts } from '../../prompts-api.ts'

export interface PromptsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  entries?: PromptEntry[]
  /** Message of the last failed read; a later success clears it. */
  error?: string
}

export interface PromptsFace {
  hooks: { prompts: SnapshotStore<PromptsState> }
  load: () => void
  refresh: () => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Reads which prompt files of the root differ from the shipped ones. */
export class PromptsController {
  readonly store = createSnapshotStore<PromptsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly face: PromptsFace = {
    hooks: { prompts: this.store },
    load: () => { if (this.store.getSnapshot().status === 'idle') void this.read(false) },
    refresh: () => { void this.read(true) },
  }

  inject(): PromptsFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
  }

  private async read(refreshing: boolean): Promise<void> {
    this.store.update((draft) => { if (refreshing) draft.refreshing = true; else draft.status = 'loading' })
    try {
      const entries = await listPrompts(this.abort.signal)
      this.store.update((draft) => { draft.status = 'ready'; draft.entries = entries; delete draft.error })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.entries === undefined) draft.status = 'failed' })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
