import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LorebookSummary } from '../../../shared/lorebooks.ts'
import type { OpenChat } from '../../chat/open-chat.ts'
import type { SelectionChoice, SelectionPreview } from '../../../shared/import-selection.ts'
import { importStagedLorebook, importVerbatimLorebook, stageFile } from '../../import-selection-api.ts'
import { authorLorebook, createLorebook, deleteLorebook, listLorebooks } from '../../lorebooks-api.ts'

export interface LorebooksState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  books?: LorebookSummary[]
  /** Message of the last failed read; a later success clears it. */
  error?: string
}

export interface ImportedLorebook { started: boolean; failure?: string }

export interface LorebooksFace {
  hooks: { lorebooks: SnapshotStore<LorebooksState> }
  load: () => void
  refresh: () => void
  /** Makes an empty lorebook; rejects with the host's reason. */
  create: (name: string, title: string, description: string) => Promise<void>
  remove: (name: string) => Promise<void>
  /** Opens the lorebook's authoring chat in the main area. */
  author: (name: string) => Promise<void>
  /** Sends a SillyTavern lorebook to the host, which says what it holds for the person to choose from; rejects with the host's reason. */
  stage: (file: File) => Promise<SelectionPreview>
  /** Imports the chosen entries of a staged lorebook into a new library lorebook and opens its authoring chat. */
  importStaged: (choice: SelectionChoice, name: string) => Promise<ImportedLorebook>
  /** Imports the chosen entries of a staged lorebook as they are, with no assistant; resolves with how many entries the new lorebook has. */
  importVerbatim: (choice: SelectionChoice, name: string, knownBy: 'everyone' | 'master') => Promise<number>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Reads the lorebook library from the host and makes, removes and opens its lorebooks. */
export class LorebooksController {
  readonly store = createSnapshotStore<LorebooksState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly face: LorebooksFace = {
    hooks: { lorebooks: this.store },
    load: () => { if (this.store.getSnapshot().status === 'idle') void this.read(false) },
    refresh: () => { void this.read(true) },
    create: async (name, title, description) => { await createLorebook({ name, ...(title === '' ? {} : { title }), ...(description === '' ? {} : { description }) }, this.abort.signal); await this.read(true) },
    remove: async (name) => { await deleteLorebook(name, this.abort.signal); await this.read(true) },
    author: async (name) => { this.openChat((await authorLorebook(name, this.language(), this.abort.signal)).chatSessionId) },
    stage: async file => await stageFile('lorebook', file, this.abort.signal),
    importVerbatim: async (choice, name, knownBy) => {
      const made = await importVerbatimLorebook(choice, { name, knownBy }, this.abort.signal)
      await this.read(true)
      return made.entries
    },
    importStaged: async (choice, name) => {
      const opened = await importStagedLorebook(choice, { name, language: this.language() }, this.abort.signal)
      await this.read(true)
      this.openChat(opened.chatSessionId)
      return { started: opened.started, ...(opened.failure === undefined ? {} : { failure: opened.failure }) }
    },
  }

  constructor(private readonly openChat: OpenChat, private readonly language: () => string) {}

  inject(): LorebooksFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
  }

  private async read(refreshing: boolean): Promise<void> {
    this.store.update((draft) => { if (refreshing) draft.refreshing = true; else draft.status = 'loading' })
    try {
      const books = await listLorebooks(this.abort.signal)
      this.store.update((draft) => { draft.status = 'ready'; draft.books = books; delete draft.error })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.books === undefined) draft.status = 'failed' })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
