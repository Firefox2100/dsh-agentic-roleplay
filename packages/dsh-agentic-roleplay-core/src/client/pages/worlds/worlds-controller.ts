import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { API_PREFIX, type WorldsPayload } from '../../../shared/worlds.ts'

export interface WorldsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  payload?: WorldsPayload
  /** Message of the last failed request; a later success clears it. */
  error?: string
}

export interface WorldsFace {
  hooks: {
    /** Bound by the renderer as `useWorlds`. */
    worlds: SnapshotStore<WorldsState>
  }
  load: () => void
  refresh: () => void
}

async function request(path: string, init: RequestInit, signal: AbortSignal): Promise<WorldsPayload> {
  const response = await fetch(`${API_PREFIX}${path}`, { ...init, credentials: 'same-origin', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as WorldsPayload
}

/** Loads the world list from the host and keeps it until the user refreshes. */
export class WorldsController {
  readonly store = createSnapshotStore<WorldsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly face: WorldsFace = {
    hooks: { worlds: this.store },
    load: () => { void this.load() },
    refresh: () => { void this.refresh() },
  }

  inject(): WorldsFace {
    return this.face
  }

  async load(): Promise<void> {
    if (this.store.getSnapshot().status !== 'idle') return
    this.store.update((draft) => { draft.status = 'loading' })
    await this.run('/worlds', {})
  }

  async refresh(): Promise<void> {
    const { refreshing, status } = this.store.getSnapshot()
    if (refreshing || status === 'loading') return
    this.store.update((draft) => { draft.refreshing = true })
    await this.run('/worlds/refresh', { method: 'POST' })
  }

  dispose(): void {
    this.abort.abort()
  }

  /** A failure keeps the list already shown; with nothing shown yet it becomes the page's state. */
  private async run(path: string, init: RequestInit): Promise<void> {
    try {
      const payload = await request(path, init, this.abort.signal)
      this.store.update((draft) => {
        draft.status = 'ready'
        draft.payload = payload
        delete draft.error
      })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => {
        draft.error = error instanceof Error ? error.message : String(error)
        if (draft.payload === undefined) draft.status = 'failed'
      })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
