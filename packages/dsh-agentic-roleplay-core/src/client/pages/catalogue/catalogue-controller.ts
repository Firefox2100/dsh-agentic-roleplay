import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CatalogueSourceStatus } from '../../../shared/catalogue.ts'
import type { OpenChat } from '../../chat/open-chat.ts'
import { loadSources } from './catalogue-api.ts'

export interface CatalogueState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  sources: CatalogueSourceStatus[]
  /** Counts the times the configured catalogues were read again, so a page can ask for its worlds again when they change. */
  revision: number
  error?: string
}

export interface CatalogueFace {
  hooks: { catalogue: SnapshotStore<CatalogueState> }
  /** Reads the configured catalogues, which carry whether each has a key. */
  load: () => void
  /** Shows a DSH chat in place of the panel. */
  openChat: (chatSessionId: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The configured catalogues as the host sees them, read again whenever the settings change. */
export class CatalogueController {
  readonly store = createSnapshotStore<CatalogueState>({ status: 'idle', sources: [], revision: 0 })
  private readonly abort = new AbortController()
  private readonly face: CatalogueFace = {
    hooks: { catalogue: this.store },
    load: () => { void this.read() },
    openChat: (chatSessionId) => { this.openChat(chatSessionId) },
  }

  constructor(private readonly openChat: OpenChat) {}

  inject(): CatalogueFace {
    return this.face
  }

  /** Reads them again; the page asks for its worlds again when the sources differ from before. */
  async read(): Promise<void> {
    this.store.update((draft) => { if (draft.status === 'idle') draft.status = 'loading' })
    try {
      const sources = await loadSources(this.abort.signal)
      this.store.update((draft) => {
        if (JSON.stringify(draft.sources) !== JSON.stringify(sources)) draft.revision += 1
        draft.status = 'ready'
        draft.sources = sources
        delete draft.error
      })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.status === 'loading') draft.status = 'failed' })
    }
  }

  dispose(): void {
    this.abort.abort()
  }
}
