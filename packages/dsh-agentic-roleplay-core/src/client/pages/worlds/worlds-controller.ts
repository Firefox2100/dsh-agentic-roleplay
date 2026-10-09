import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { OpenChat } from '../../chat/open-chat.ts'
import type { ChatSettings } from '../../../shared/settings.ts'
import type { CharacterSummary, StartedSession, WorldCharactersPayload } from '../../../shared/sessions.ts'
import { API_PREFIX, type WorldProblem, type WorldsPayload } from '../../../shared/worlds.ts'

/** The dialog asking what a new session needs, for one world. */
export interface StartDialog {
  worldId: string
  worldName: string
  status: 'loading' | 'ready' | 'failed'
  characters: readonly CharacterSummary[]
  /** Why the characters could not be loaded, or why the session could not be started. */
  error?: string
  submitting: boolean
}

/** A session that was started but whose chat could not be opened; `sequence` tells a new notice from the one already shown. */
export interface StartedNotice {
  sequence: number
  sessionName: string
  /** Why the chat could not be opened. */
  reason: string
}

export interface WorldsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  payload?: WorldsPayload
  /** Message of the last failed request; a later success clears it. */
  error?: string
  dialog?: StartDialog
  started?: StartedNotice
  authoring?: { worldId: string; error?: string }
}

export interface StartOptions {
  name: string
  playerCharacterId: string
  /** Left out unless the player changed them: the defaults apply. */
  settings?: ChatSettings
}

export interface WorldsFace {
  hooks: {
    /** Bound by the renderer as `useWorlds`. */
    worlds: SnapshotStore<WorldsState>
  }
  load: () => void
  refresh: () => void
  openStartDialog: (worldId: string, worldName: string) => void
  closeStartDialog: () => void
  startSession: (options: StartOptions) => void
  dismissStarted: () => void
  openAuthoring: (worldId: string, title: string) => void
  /** Shows a DSH chat in place of the panel. */
  openChat: (chatSessionId: string) => void
}

async function request<T>(path: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, { ...init, credentials: 'same-origin', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: WorldProblem[] } | undefined
    const reason = typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()
    const detail = body?.problems?.[0]?.message
    throw new Error(detail === undefined ? reason : `${reason}: ${detail}`)
  }
  return await response.json() as T
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Loads the world list from the host, keeps it until the user refreshes, and starts sessions. */
export class WorldsController {
  readonly store = createSnapshotStore<WorldsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly openChat: OpenChat
  private notices = 0
  private dialogs = 0
  private readonly face: WorldsFace = {
    hooks: { worlds: this.store },
    load: () => { void this.load() },
    refresh: () => { void this.refresh() },
    openStartDialog: (worldId, worldName) => { void this.openStartDialog(worldId, worldName) },
    closeStartDialog: () => { this.closeStartDialog() },
    startSession: (options) => { void this.startSession(options) },
    dismissStarted: () => { this.store.update((draft) => { delete draft.started }) },
    openAuthoring: (worldId, title) => { void this.openAuthoring(worldId, title) },
    openChat: (chatSessionId) => { this.openChat(chatSessionId) },
  }

  constructor(openChat: OpenChat, private readonly language: () => string) {
    this.openChat = openChat
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

  async openAuthoring(worldId: string, title: string): Promise<void> {
    const current = this.store.getSnapshot().authoring
    if (current?.worldId === worldId && current.error === undefined) return
    this.store.update((draft) => { draft.authoring = { worldId } })
    try {
      const opened = await request<{ chatSessionId: string }>(`/worlds/authoring?id=${encodeURIComponent(worldId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, language: this.language() }) }, this.abort.signal)
      this.store.update((draft) => { delete draft.authoring })
      this.openChat(opened.chatSessionId)
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.authoring = { worldId, error: messageOf(error) } })
    }
  }

  /** Open the dialog for a world and load the characters it offers. */
  async openStartDialog(worldId: string, worldName: string): Promise<void> {
    const token = ++this.dialogs
    this.store.update((draft) => { draft.dialog = { worldId, worldName, status: 'loading', characters: [], submitting: false } })
    try {
      const { characters } = await request<WorldCharactersPayload>(`/worlds/characters?id=${encodeURIComponent(worldId)}`, {}, this.abort.signal)
      this.updateDialog(token, (dialog) => { dialog.status = 'ready'; dialog.characters = characters })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.updateDialog(token, (dialog) => { dialog.status = 'failed'; dialog.error = messageOf(error) })
    }
  }

  closeStartDialog(): void {
    if (this.store.getSnapshot().dialog?.submitting === true) return
    this.dialogs++
    this.store.update((draft) => { delete draft.dialog })
  }

  /** Start the session the open dialog asks for; the dialog stays open, with the reason, if that fails. */
  async startSession(options: StartOptions): Promise<void> {
    const dialog = this.store.getSnapshot().dialog
    if (dialog === undefined || dialog.status !== 'ready' || dialog.submitting) return
    const token = this.dialogs
    this.updateDialog(token, (draft) => { draft.submitting = true; delete draft.error })
    try {
      const started = await request<StartedSession>('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: dialog.worldId, name: options.name, playerCharacterId: options.playerCharacterId, ...(options.settings === undefined ? {} : { settings: options.settings }) }),
      }, this.abort.signal)
      this.dialogs++
      this.store.update((draft) => { delete draft.dialog })
      try {
        this.openChat(started.chatSessionId)
      } catch (error) {
        this.store.update((draft) => { draft.started = { sequence: ++this.notices, sessionName: started.name, reason: messageOf(error) } })
      }
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.updateDialog(token, (draft) => { draft.submitting = false; draft.error = messageOf(error) })
    }
  }

  dispose(): void {
    this.abort.abort()
  }

  /** Apply a change to the dialog only while it is still the one that asked. */
  private updateDialog(token: number, change: (dialog: StartDialog) => void): void {
    if (token !== this.dialogs) return
    this.store.update((draft) => { if (draft.dialog !== undefined) change(draft.dialog) })
  }

  /** A failure keeps the list already shown; with nothing shown yet it becomes the page's state. */
  private async run(path: string, init: RequestInit): Promise<void> {
    try {
      const payload = await request<WorldsPayload>(path, init, this.abort.signal)
      this.store.update((draft) => {
        draft.status = 'ready'
        draft.payload = payload
        delete draft.error
      })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => {
        draft.error = messageOf(error)
        if (draft.payload === undefined) draft.status = 'failed'
      })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { draft.refreshing = false })
    }
  }
}
