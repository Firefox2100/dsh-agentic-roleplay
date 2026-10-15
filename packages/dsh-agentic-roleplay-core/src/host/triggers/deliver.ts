import type { Session } from '@dsh-agentic-roleplay/state'
import type { TriggerNote } from 'dsh-roleplay-model'

const KEY = 'triggers.withdrawn'
/** The reasons kept for notes that were withdrawn: the latest of them. */
const KEPT = 100

type DeliverySession = Pick<Session, 'metadata' | 'triggers' | 'deliverNotes' | 'transaction'>

/** Why a note was withdrawn instead of told, by the number of the note. */
export function readWithdrawn(session: Pick<Session, 'metadata'>): Record<number, string> {
  const stored = session.metadata.getValue(KEY)
  if (!Array.isArray(stored)) return {}
  return Object.fromEntries(stored.flatMap((entry) => {
    const { note, reason } = (entry ?? {}) as { note?: unknown; reason?: unknown }
    return typeof note === 'number' && typeof reason === 'string' ? [[note, reason]] : []
  }))
}

/**
 * Tells these notes as the story stands now: each is written from the story at this moment, and one that no longer applies is let go and the
 * reason kept (`readWithdrawn`). @returns what is to be told, with the number of its note.
 */
export function deliverNow(session: DeliverySession, notes: readonly TriggerNote[], clock: { now: number; zone: string }): { id: number; text: string }[] {
  const { shown, withdrawn } = session.deliverNotes(notes, clock)
  if (withdrawn.length > 0) {
    session.transaction(() => {
      for (const { note } of withdrawn) session.triggers.resolveNote(note.id, 'lapsed')
      const before = Object.entries(readWithdrawn(session)).map(([note, reason]) => ({ note: Number(note), reason }))
      session.metadata.setValue(KEY, [...before, ...withdrawn.map(({ note, reason }) => ({ note: note.id, reason }))].slice(-KEPT))
    })
  }
  return shown.map(({ note, text }) => ({ id: note.id, text }))
}
