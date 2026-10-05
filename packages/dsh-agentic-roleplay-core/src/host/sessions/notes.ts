import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase } from 'dsh-roleplay-state'
import { NOTE_KINDS, type Note } from '../../shared/notes.ts'
import { SessionNotFoundError } from './errors.ts'

const KEY = 'notes'

interface NoteSession {
  metadata: { getValue(key: string): unknown; setValue(key: string, value: unknown): void }
}

const isNote = (value: unknown): value is Note => {
  if (typeof value !== 'object' || value === null) return false
  const note = value as Record<string, unknown>
  return NOTE_KINDS.includes(note['kind'] as Note['kind']) && typeof note['turn'] === 'number'
    && Array.isArray(note['lines']) && note['lines'].every(line => typeof line === 'string')
}

/** The notes of a session, at most one per kind. */
export function readNotes(session: NoteSession): Note[] {
  const stored = session.metadata.getValue(KEY)
  return Array.isArray(stored) ? stored.filter(isNote) : []
}

/** Replaces the note of the same kind. */
export function putNote(session: NoteSession, note: Note): void {
  session.metadata.setValue(KEY, [...readNotes(session).filter(existing => existing.kind !== note.kind), note])
}

/** Removes every note: they belong to the turn that made them. */
export function clearNotes(session: NoteSession): void {
  if (readNotes(session).length > 0) session.metadata.setValue(KEY, [])
}

export interface NotesDeps {
  sessionsDir: () => string
  open: (id: string) => NoteSession
}

/**
 * The notes of a session, for the player's screen.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export function notesOfSession(deps: NotesDeps, id: string): Note[] {
  if (!isSessionId(id) || !existsSync(sessionDatabase(deps.sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  return readNotes(deps.open(id))
}
