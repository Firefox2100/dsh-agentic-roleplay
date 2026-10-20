import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PresetSummary } from '../../../shared/presets.ts'
import type { OpenChat } from '../../chat/open-chat.ts'
import { authorPreset, createPreset, deletePreset, importPreset, listPresets } from '../../presets-api.ts'

export interface PresetsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  presets?: PresetSummary[]
  /** Message of the last failed read; a later success clears it. */
  error?: string
}

export interface ImportedPreset { started: boolean; failure?: string }

export interface PresetsFace {
  hooks: { presets: SnapshotStore<PresetsState> }
  load: () => void
  refresh: () => void
  /** Makes a preset from the shipped prompts; rejects with the host's reason. */
  create: (name: string, title: string, description: string) => Promise<void>
  remove: (name: string) => Promise<void>
  /** Opens the preset's authoring chat in the main area. */
  author: (name: string) => Promise<void>
  /** Uploads a SillyTavern preset into a new library preset and opens its authoring chat. */
  importFile: (name: string, file: File) => Promise<ImportedPreset>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Reads the preset library from the host and makes, removes and opens its presets. */
export class PresetsController {
  readonly store = createSnapshotStore<PresetsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly face: PresetsFace = {
    hooks: { presets: this.store },
    load: () => { if (this.store.getSnapshot().status === 'idle') void this.read(false) },
    refresh: () => { void this.read(true) },
    create: async (name, title, description) => { await createPreset({ name, ...(title === '' ? {} : { title }), ...(description === '' ? {} : { description }) }, this.abort.signal); await this.read(true) },
    remove: async (name) => { await deletePreset(name, this.abort.signal); await this.read(true) },
    author: async (name) => { this.openChat((await authorPreset(name, this.language(), this.abort.signal)).chatSessionId) },
    importFile: async (name, file) => {
      const opened = await importPreset(name, file, this.language(), this.abort.signal)
      await this.read(true)
      this.openChat(opened.chatSessionId)
      return { started: opened.started, ...(opened.failure === undefined ? {} : { failure: opened.failure }) }
    },
  }

  constructor(private readonly openChat: OpenChat, private readonly language: () => string) {}

  inject(): PresetsFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
  }

  private async read(refreshing: boolean): Promise<void> {
    this.store.update((draft) => { if (refreshing) draft.refreshing = true; else draft.status = 'loading' })
    try {
      const presets = await listPresets(this.abort.signal)
      this.store.update((draft) => { draft.status = 'ready'; draft.presets = presets; delete draft.error })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.error = messageOf(error); if (draft.presets === undefined) draft.status = 'failed' })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
