import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import { MAX_JOURNAL, type Journal } from '../../shared/journal.ts'
import { atomicWriteJson } from '../atomic-write.ts'
import { SessionNotFoundError } from '../sessions/errors.ts'

export const JOURNAL_FILE = 'journal.json'

export class InvalidJournalError extends Error {}

function folderOf(sessionsDir: string, id: string): string {
  if (!isSessionId(id) || !existsSync(sessionDatabase(sessionsDir, id))) throw new SessionNotFoundError(`no session "${id}"`)
  return sessionFolder(sessionsDir, id)
}

/**
 * The player's notes. They sit beside the database, so taking the story back does not touch them and a branch starts with a copy.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export async function readJournal(sessionsDir: string, id: string): Promise<Journal> {
  const file = join(folderOf(sessionsDir, id), JOURNAL_FILE)
  let value: unknown
  try { value = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '' }
    throw error
  }
  const { text, updatedAt } = (value ?? {}) as { text?: unknown; updatedAt?: unknown }
  return { text: typeof text === 'string' ? text : '', ...typeof updatedAt === 'string' ? { updatedAt } : {} }
}

/** @throws {InvalidJournalError} for text that is not a string or is over `MAX_JOURNAL`. */
export async function writeJournal(sessionsDir: string, id: string, body: unknown, now: () => Date = () => new Date()): Promise<Journal> {
  const folder = folderOf(sessionsDir, id)
  const text = (body as { text?: unknown } | null)?.text
  if (typeof text !== 'string') throw new InvalidJournalError('the journal needs a text')
  if (text.length > MAX_JOURNAL) throw new InvalidJournalError(`the journal may hold at most ${MAX_JOURNAL} characters`)
  const journal: Journal = { text, updatedAt: now().toISOString() }
  await atomicWriteJson(join(folder, JOURNAL_FILE), journal)
  return journal
}
