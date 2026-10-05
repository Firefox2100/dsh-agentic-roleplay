import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** The slice of the session store the purge reads: the headers of every stored session. */
export interface StoredSessions {
  list(): Promise<readonly { header: StoredHeader }[]>
}

export interface StoredHeader {
  id: string
  cwd?: string
  origin?: string
  parentSession?: string
}

export interface PurgeDeps {
  /** The folder DSH keeps its sessions in: one folder per project, one per session in it. */
  storeRoot: () => string
  stored: () => StoredSessions | undefined
  /** Stops what the chat has running and writes what is buffered, so that nothing is written once its files are gone. */
  quiet: (chat: string) => Promise<void>
  /** Called with each session that is gone, so that the browser forgets it. */
  removed: (id: string) => void
  /** The cache DSH keeps of what it read from a session, when there is one; stock DSH gives it no way to forget a session, a cache that has one is told. */
  projection?: () => { delete?(id: string): Promise<unknown>; whenIdle?(): Promise<void> } | undefined
}

/** A segment of a path for what is not a letter, digit or one of `._-`: `~` and four hex digits, as DSH writes it. */
const segment = (raw: string): string => {
  if (raw === '') throw new Error('cannot name the folder of a session with no id')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  return [...raw].map(char => (char !== '~' && /^[A-Za-z0-9._-]$/.test(char) ? char : `~${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)).join('')
}

/** The folder name of a project: separators become one `-`, other unusual characters are escaped, and it is bounded. */
const projectFolder = (cwd: string): string => {
  let readable = ''
  let separator = false
  for (const char of cwd) {
    if (char === '/' || char === '\\' || char === ':') {
      if (!separator) readable += '-'
      separator = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separator = false
    } else {
      readable += `~${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      separator = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** The folder a stored session owns. */
export const sessionFolderOf = (root: string, header: StoredHeader): string =>
  join(root, header.cwd === undefined ? '_no-cwd' : projectFolder(header.cwd), segment(header.id))

/** The sessions that were started by `chat`, and by those, to any depth: its characters, its record keeper, its world author. */
export function helpersOf(headers: readonly StoredHeader[], chat: string): StoredHeader[] {
  const found: StoredHeader[] = []
  const seen = new Set<string>([chat])
  for (let frontier = [chat]; frontier.length > 0;) {
    const next: string[] = []
    for (const header of headers) {
      if (header.origin !== 'subagent' || header.parentSession === undefined || !frontier.includes(header.parentSession) || seen.has(header.id)) continue
      seen.add(header.id)
      found.push(header)
      next.push(header.id)
    }
    frontier = next
  }
  return found
}

/**
 * Only a folder that is plainly one session's own is removed: it has the session's name, is not reached through a link, and holds a
 * session log. Anything else is left, and said, rather than deleted.
 */
async function removeOwnFolder(folder: string, id: string): Promise<boolean> {
  let status
  try {
    status = await lstat(folder)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`refusing to delete ${folder}: it is not a plain folder`)
  if (basename(folder) !== segment(id)) throw new Error(`refusing to delete ${folder}: it is not the folder of ${id}`)
  if (!(await readdir(folder)).some(name => name.startsWith('session.'))) throw new Error(`refusing to delete ${folder}: it holds no session log`)
  await rm(folder, { recursive: true, force: true })
  return true
}

/**
 * Remove the chat of a roleplay session from DSH's store for good: its log and the logs of everything it started (the characters,
 * the record keeper, the world author), each in its own folder. What is still running is stopped first. Nothing is removed when the
 * store cannot be read; when one folder cannot be removed the rest are still tried, and the failure is thrown after.
 * DSH has no way to forget a stored session, so its own bookkeeping may keep the id (harmless: it is not listed or read again).
 * @returns the ids of the sessions whose folders were removed.
 * @throws {Error} when the store is not available, or a folder could not be removed.
 */
export async function purgeChat(deps: PurgeDeps, chat: string): Promise<string[]> {
  const stored = deps.stored()
  if (stored === undefined) throw new Error('the session store of this DSH profile cannot be listed, so the chat cannot be deleted')
  await deps.quiet(chat)
  const headers = (await stored.list()).map(entry => entry.header)
  const own = headers.find(header => header.id === chat)
  const victims = [...helpersOf(headers, chat).reverse(), ...(own === undefined ? [] : [own])]
  const projection = deps.projection?.()
  await projection?.whenIdle?.()
  const removed: string[] = []
  const failures: string[] = []
  for (const header of victims) {
    try {
      const existed = await removeOwnFolder(sessionFolderOf(deps.storeRoot(), header), header.id)
      if (typeof projection?.delete === 'function') await projection.delete(header.id)
      if (existed) removed.push(header.id)
      deps.removed(header.id)
    } catch (error) {
      failures.push(`${header.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length > 0) throw new Error(`the chat could not be deleted completely (${removed.length} of ${victims.length} removed): ${failures.join('; ')}`)
  return removed
}
