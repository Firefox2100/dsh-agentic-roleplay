import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { NewSession, SessionMetadata } from 'dsh-roleplay-model'
import { ConflictError, NotFoundError } from './errors.ts'
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

/** What a copy of a session is made from: a snapshot of it, or its database as it is. */
export type ForkSource = { snapshot: string } | { live: Pick<SessionStore, 'snapshotTo'> }

export interface ForkOptions {
  name: string
  /** The snapshots the copy keeps, besides its database; each must exist. */
  keep: readonly string[]
}

/**
 * Make a new session from a state of another: a folder of its own with the database, the settings and the named snapshots, and
 * the identity of the new session in place of the old. Nothing is left behind when it fails.
 * @throws {ConflictError} when the new id exists. @throws {NotFoundError} when the snapshot or a kept snapshot does not exist.
 */
export function forkSession(sessionsDir: string, fromId: string, toId: string, source: ForkSource, options: ForkOptions, storeOptions: StoreOptions = {}): void {
  const target = sessionFolder(sessionsDir, toId)
  const from = sessionFolder(sessionsDir, fromId)
  const used = 'snapshot' in source ? [source.snapshot] : []
  for (const name of [...options.keep, ...used]) {
    if (!existsSync(snapshotPath(sessionsDir, fromId, name))) throw new NotFoundError(`session ${fromId} has no snapshot "${name}"`)
  }
  try {
    mkdirSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictError(`session ${toId} already exists`, { cause: error })
    throw error
  }
  try {
    const file = sessionDatabase(sessionsDir, toId)
    if ('snapshot' in source) copyFileSync(snapshotPath(sessionsDir, fromId, source.snapshot), file)
    else source.live.snapshotTo(file)
    if (existsSync(join(from, 'settings.json'))) copyFileSync(join(from, 'settings.json'), join(target, 'settings.json'))
    if (options.keep.length > 0) mkdirSync(join(target, SNAPSHOT_FOLDER))
    for (const name of options.keep) copyFileSync(snapshotPath(sessionsDir, fromId, name), snapshotPath(sessionsDir, toId, name))
    const store = openSessionStore(file, storeOptions)
    try { store.metadata.rebrand(toId, options.name) } finally { store.close() }
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
}

const SNAPSHOT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const SNAPSHOT_FOLDER = 'snapshots'

/** The place of a named snapshot of a session's database. @throws {RangeError} for a name that is not lowercase letters, digits and hyphens. */
export function snapshotPath(sessionsDir: string, id: string, name: string): string {
  if (!SNAPSHOT_NAME.test(name)) throw new RangeError(`"${name}" is not a snapshot name`)
  return join(sessionFolder(sessionsDir, id), SNAPSHOT_FOLDER, `${name}.sqlite`)
}

/** Take a snapshot of an open session under a name, replacing one of that name; it is written aside and renamed, so a snapshot is never half written. */
export function takeSnapshot(sessionsDir: string, id: string, name: string, store: Pick<SessionStore, 'snapshotTo'>): string {
  const target = snapshotPath(sessionsDir, id, name)
  mkdirSync(join(sessionFolder(sessionsDir, id), SNAPSHOT_FOLDER), { recursive: true })
  const aside = `${target}.writing`
  rmSync(aside, { force: true })
  store.snapshotTo(aside)
  renameSync(aside, target)
  return target
}

/** The names of a session's snapshots. */
export function snapshotNames(sessionsDir: string, id: string): string[] {
  try {
    return readdirSync(join(sessionFolder(sessionsDir, id), SNAPSHOT_FOLDER)).filter(file => file.endsWith('.sqlite')).map(file => file.slice(0, -'.sqlite'.length)).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function removeSnapshot(sessionsDir: string, id: string, name: string): void {
  rmSync(snapshotPath(sessionsDir, id, name), { force: true })
}

/**
 * Put a snapshot in the place of the session's database. The session must not be open (the service
 * closes it first); the copy is made aside and renamed over the database.
 * @throws {NotFoundError} when there is no such snapshot.
 */
export function restoreSnapshot(sessionsDir: string, id: string, name: string, storeOptions: StoreOptions = {}): void {
  const source = snapshotPath(sessionsDir, id, name)
  if (!existsSync(source)) throw new NotFoundError(`session ${id} has no snapshot "${name}"`)
  const database = sessionDatabase(sessionsDir, id)
  const aside = `${database}.restoring`
  copyFileSync(source, aside)
  for (const sidecar of ['-wal', '-shm', '-journal']) rmSync(`${database}${sidecar}`, { force: true })
  const previous = identityOf(database, storeOptions)
  renameSync(aside, database)
  if (previous !== undefined) {
    const store = openSessionStore(database, storeOptions)
    try { store.metadata.rebrand(previous.id, previous.name, previous.createdAt) } finally { store.close() }
  }
}

/** The identity the database has now, which a snapshot taken under another id (a fork's parent) must not take away. */
function identityOf(database: string, storeOptions: StoreOptions): { id: string; name: string; createdAt: string } | undefined {
  if (!existsSync(database)) return undefined
  const store = openSessionStore(database, storeOptions)
  try {
    const { id, name, createdAt } = store.metadata.get()
    return { id, name, createdAt }
  } finally { store.close() }
}
