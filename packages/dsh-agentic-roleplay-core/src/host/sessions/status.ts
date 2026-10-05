import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STATUS_FILE = 'status.json'

/** What is kept about a session besides its story: it lives beside the database, so putting the story back never changes it. */
export interface SessionStatus {
  /** When the session was put away; absent for one in use. */
  archivedAt?: string
}

/**
 * @throws {Error} when the file is there and cannot be read as a status: it decides whether a session is shown, so it is not guessed at.
 */
export function readStatus(folder: string): SessionStatus {
  let text: string
  try {
    text = readFileSync(join(folder, STATUS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const value = JSON.parse(text) as Record<string, unknown>
  if (typeof value !== 'object' || value === null || (value['archivedAt'] !== undefined && typeof value['archivedAt'] !== 'string')) throw new Error(`${join(folder, STATUS_FILE)} is not a session status`)
  return typeof value['archivedAt'] === 'string' ? { archivedAt: value['archivedAt'] } : {}
}

export function writeStatus(folder: string, status: SessionStatus): void {
  const target = join(folder, STATUS_FILE)
  const aside = `${target}.writing`
  writeFileSync(aside, JSON.stringify(status, null, 2))
  renameSync(aside, target)
}
