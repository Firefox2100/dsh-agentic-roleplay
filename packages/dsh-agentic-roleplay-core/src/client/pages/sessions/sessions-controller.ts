import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { OpenChat } from '../../chat/open-chat.ts'
import type { OpenedSession, SessionsPayload } from '../../../shared/sessions.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'

export interface SessionsState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  refreshing: boolean
  payload?: SessionsPayload
  /** Message of the last failed request; a later success clears it. */
  error?: string
  removal?: Removal
  /** The session whose chat is being opened. */
  opening?: string
  /** Why the last attempt to open a chat failed; cleared by the next attempt. */
  openError?: string
}

/** A session the user is being asked to delete. */
export interface Removal {
  id: string
  name: string
  deleting: boolean
  /** Why the last attempt failed. */
  error?: string
}

export interface SessionsFace {
  hooks: {
    /** Bound by the renderer as `useSessions`. */
    sessions: SnapshotStore<SessionsState>
  }
  /** Read the list again, keeping what is shown meanwhile. */
  load: () => void
  refresh: () => void
  open: (id: string) => void
  askRemoval: (id: string, name: string) => void
  cancelRemoval: () => void
  confirmRemoval: () => void
}

/** Reads the sessions list from the host. */
export class SessionsController {
  readonly store = createSnapshotStore<SessionsState>({ status: 'idle', refreshing: false })
  private readonly abort = new AbortController()
  private readonly openChat: OpenChat
  private readonly face: SessionsFace = {
    hooks: { sessions: this.store },
    load: () => { void this.read(false) },
    refresh: () => { void this.read(true) },
    open: (id) => { void this.open(id) },
    askRemoval: (id, name) => { this.store.update((draft) => { draft.removal = { id, name, deleting: false } }) },
    cancelRemoval: () => { this.cancelRemoval() },
    confirmRemoval: () => { void this.confirmRemoval() },
  }

  constructor(openChat: OpenChat) {
    this.openChat = openChat
  }

  inject(): SessionsFace {
    return this.face
  }

  dispose(): void {
    this.abort.abort()
  }

  /** Ask the host for the session's chat, creating it when it does not exist, then show it. */
  private async open(id: string): Promise<void> {
    if (this.store.getSnapshot().opening !== undefined) return
    this.store.update((draft) => { draft.opening = id; delete draft.openError })
    try {
      const response = await fetch(`${API_PREFIX}/sessions/open?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: this.abort.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
        throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
      }
      this.openChat(((await response.json()) as OpenedSession).chatSessionId)
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => { draft.openError = error instanceof Error ? error.message : String(error) })
    } finally {
      if (!this.abort.signal.aborted) this.store.update((draft) => { delete draft.opening })
    }
  }

  private cancelRemoval(): void {
    if (this.store.getSnapshot().removal?.deleting === true) return
    this.store.update((draft) => { delete draft.removal })
  }

  /** The dialog stays open, with the reason, when the host refuses. */
  private async confirmRemoval(): Promise<void> {
    const removal = this.store.getSnapshot().removal
    if (removal === undefined || removal.deleting) return
    this.store.update((draft) => {
      if (draft.removal !== undefined) { draft.removal.deleting = true; delete draft.removal.error }
    })
    try {
      const response = await fetch(`${API_PREFIX}/sessions/item?id=${encodeURIComponent(removal.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        signal: this.abort.signal,
      })
      // A session that is already gone is what the user asked for.
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
        throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
      }
      this.store.update((draft) => {
        delete draft.removal
        if (draft.payload !== undefined) {
          draft.payload = { ...draft.payload, sessions: draft.payload.sessions.filter(session => session.id !== removal.id) }
        }
      })
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.store.update((draft) => {
        if (draft.removal === undefined) return
        draft.removal.deleting = false
        draft.removal.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async read(refreshing: boolean): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.refreshing || (refreshing && state.status === 'loading')) return
    this.store.update((draft) => {
      if (refreshing) draft.refreshing = true
      else if (draft.payload === undefined) draft.status = 'loading'
    })
    try {
      const response = await fetch(`${API_PREFIX}/sessions`, { credentials: 'same-origin', signal: this.abort.signal })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
        throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
      }
      const payload = await response.json() as SessionsPayload
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
