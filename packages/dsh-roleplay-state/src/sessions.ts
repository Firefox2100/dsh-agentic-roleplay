import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { NewSession, SessionMetadata } from 'dsh-roleplay-model'
import { ConflictError } from './errors.ts'
import { createSessionStore, openSessionStore, type SessionStore, type StoreOptions } from './store.ts'

export const SESSION_DATABASE_FILE = 'session.sqlite'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A new session; its id is generated unless one is given. */
export type SessionInit = Omit<NewSession, 'id'> & { id?: string }

export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value)
}

/** The id becomes a folder name, so only a UUID v4 is accepted. */
function checked(id: string): string {
  if (!isSessionId(id)) throw new RangeError(`"${id}" is not a session id`)
  return id
}

/** Folder holding everything about one session. */
export function sessionFolder(sessionsDir: string, id: string): string {
  return join(sessionsDir, checked(id))
}

export function sessionDatabase(sessionsDir: string, id: string): string {
  return join(sessionFolder(sessionsDir, id), SESSION_DATABASE_FILE)
}

/**
 * Create `<sessionsDir>/<id>/session.sqlite` for a new session. Nothing is
 * left behind when creating the database fails.
 * @throws {ConflictError} when a session with that id already exists.
 */
export function createSession(sessionsDir: string, init: SessionInit, options: StoreOptions = {}): SessionStore {
  const id = checked(init.id ?? randomUUID())
  const folder = sessionFolder(sessionsDir, id)
  mkdirSync(sessionsDir, { recursive: true })
  try {
    mkdirSync(folder)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictError(`session ${id} already exists`, { cause: error })
    throw error
  }
  try {
    return createSessionStore(sessionDatabase(sessionsDir, id), { ...init, id }, options)
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
}

/** @throws {NotFoundError} when the session does not exist. */
export function openSession(sessionsDir: string, id: string, options: StoreOptions = {}): SessionStore {
  return openSessionStore(sessionDatabase(sessionsDir, id), options)
}

/** Remove a session's folder and everything in it. */
export function deleteSession(sessionsDir: string, id: string): void {
  rmSync(sessionFolder(sessionsDir, id), { recursive: true, force: true })
}

/** The sessions found under a sessions folder, and those that could not be read. */
export interface SessionListing {
  sessions: SessionMetadata[]
  problems: { id: string; message: string }[]
}

/**
 * Read the metadata of every session under `sessionsDir`. Folders that are not
 * named like a session are ignored; a session that cannot be read is reported
 * and left out. Order is not defined.
 * @param reuse - supplies a connection that is already open, so it is not opened twice.
 */
export function listSessions(
  sessionsDir: string,
  options: StoreOptions = {},
  reuse?: (id: string) => SessionStore | undefined,
): SessionListing {
  const listing: SessionListing = { sessions: [], problems: [] }
  let ids: string[]
  try {
    ids = readdirSync(sessionsDir, { withFileTypes: true }).filter(entry => entry.isDirectory() && isSessionId(entry.name)).map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return listing
    throw error
  }
  for (const id of ids) {
    const open = reuse?.(id)
    try {
      const store = open ?? openSession(sessionsDir, id, options)
      try {
        listing.sessions.push(store.metadata.get())
      } finally {
        if (open === undefined) store.close()
      }
    } catch (error) {
      listing.problems.push({ id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return listing
}
