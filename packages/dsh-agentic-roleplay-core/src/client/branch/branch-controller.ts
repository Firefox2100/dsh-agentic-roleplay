import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { SessionsPayload } from '../../shared/sessions.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

/** The part of DSH's list of chats this looks at: which chats there are, and which chat each was made from. */
interface ChatList {
  phase: string
  byId: Record<string, { parentId?: string; origin?: 'subagent' }>
}

export interface BranchState {
  /** The session that was just branched off, until it is named or left as it is. */
  pending?: { id: string; name: string }
  saving: boolean
  error?: string
}

export interface BranchFace {
  hooks: { branch: SnapshotStore<BranchState> }
  save: (name: string) => void
  keep: () => void
}

/**
 * A chat DSH makes as a branch of a roleplay chat is given a session by the host, named after the first. Here the player is asked
 * for a name for it. Only a chat that appears while the client runs is asked about, never one that was already there.
 */
export class BranchController {
  readonly store = createSnapshotStore<BranchState>({ saving: false })
  private readonly seen = new Set<string>()
  private seeded = false
  private readonly face: BranchFace = {
    hooks: { branch: this.store },
    save: (name) => { void this.save(name) },
    keep: () => { this.store.update((draft) => { delete draft.pending; delete draft.error }) },
  }

  inject(): BranchFace {
    return this.face
  }

  /** Follows DSH's list of chats; returns what stops it. */
  watch(list: ObservableSnapshot<ChatList>): () => void {
    const look = (): void => {
      const state = list.getSnapshot()
      if (state.phase !== 'ready') return
      const fresh = Object.keys(state.byId).filter(id => !this.seen.has(id))
      for (const id of fresh) this.seen.add(id)
      if (!this.seeded) { this.seeded = true; return }
      for (const id of fresh) {
        const row = state.byId[id]!
        if (row.origin === 'subagent' || row.parentId === undefined || roleplaySessionOf(id) === undefined || roleplaySessionOf(row.parentId) === undefined) continue
        void this.ask(id)
      }
    }
    look()
    return list.subscribe(look)
  }

  private async ask(chat: string): Promise<void> {
    const response = await fetch(`${API_PREFIX}/sessions`)
    if (!response.ok) return
    const session = (await response.json() as SessionsPayload).sessions.find(candidate => candidate.chatSessionId === chat)
    if (session === undefined) return
    this.store.update((draft) => { draft.pending = { id: session.id, name: session.name }; delete draft.error })
  }

  private async save(name: string): Promise<void> {
    const pending = this.store.getSnapshot().pending
    if (pending === undefined || this.store.getSnapshot().saving) return
    this.store.update((draft) => { draft.saving = true; delete draft.error })
    try {
      const response = await fetch(`${API_PREFIX}/sessions/rename?id=${encodeURIComponent(pending.id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `the request failed (${response.status})`)
      this.store.update((draft) => { draft.saving = false; delete draft.pending })
    } catch (error) {
      this.store.update((draft) => { draft.saving = false; draft.error = error instanceof Error ? error.message : String(error) })
    }
  }
}
