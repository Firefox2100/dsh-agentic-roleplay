import type { RoleplayState } from '@dsh-agentic-roleplay/state'

export const UNDO_SNAPSHOT = 'doctor-undo'
const UNDO_KEY = 'doctor.undo'

export class UndoRefusedError extends Error {}

export interface UndoDeps {
  state: Pick<RoleplayState, 'snapshot' | 'snapshots' | 'removeSnapshot' | 'restore' | 'openSession'>
  sessionsDir: () => string
  /** Whether the story's own chat is playing a turn. */
  busy: (id: string) => boolean
  /** Stops the story's background work for the chat and waits for it, so nothing holds the database across a restore. */
  halt: (id: string) => Promise<void>
}

/** Keeps the story as it stands, to put back after the one approved edit that is about to be applied. */
export function keepBeforeEdit(deps: UndoDeps, id: string): void {
  const dir = deps.sessionsDir()
  deps.state.snapshot(dir, id, UNDO_SNAPSHOT)
  const { metadata } = deps.state.openSession(dir, id)
  metadata.setValue(UNDO_KEY, { turns: metadata.get().turns })
}

/**
 * Puts the story back as it was before the last edit the doctor applied. The story is not taken back across a turn: what a later turn recorded
 * and the conversation it went with would no longer match.
 * @throws {UndoRefusedError} when nothing was kept, a turn was played or is playing since, or the edit was undone already.
 */
export async function undoLastEdit(deps: UndoDeps, id: string): Promise<void> {
  const dir = deps.sessionsDir()
  const session = deps.state.openSession(dir, id)
  const kept = session.metadata.getValue(UNDO_KEY) as { turns?: number } | undefined
  if (kept === undefined || !deps.state.snapshots(dir, id).includes(UNDO_SNAPSHOT)) throw new UndoRefusedError('there is no edit of mine to undo: nothing was kept, or it was undone already')
  if (deps.busy(id)) throw new UndoRefusedError('a turn is being played: undo after it has been delivered, and only if no turn is played after it')
  if (session.metadata.get().turns !== kept.turns) throw new UndoRefusedError('a turn was played after the edit, so the story cannot be put back without losing it: mend what is wrong with a new edit instead')
  await deps.halt(id)
  deps.state.restore(dir, id, UNDO_SNAPSHOT)
  deps.state.removeSnapshot(dir, id, UNDO_SNAPSHOT)
}
