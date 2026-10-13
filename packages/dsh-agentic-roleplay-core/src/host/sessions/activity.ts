import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ACTIVITY, type ActivityEntry, type RunDetail } from '../../shared/activity.ts'

const KEY = 'activity'

interface ActivitySession {
  metadata: { getValue(key: string): unknown; setValue(key: string, value: unknown): void }
}

const isEntry = (value: unknown): value is ActivityEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry['at'] === 'number' && typeof entry['label'] === 'string' && typeof entry['model'] === 'string'
    && typeof entry['ms'] === 'number' && typeof entry['calls'] === 'number' && (entry['error'] === undefined || typeof entry['error'] === 'string')
}

/** The recorded runs, oldest first. */
export function readActivity(session: ActivitySession): ActivityEntry[] {
  const stored = session.metadata.getValue(KEY)
  return Array.isArray(stored) ? stored.filter(isEntry) : []
}

/** Files the run and returns the runs that fell off the end of the record to make room. */
export function recordActivity(session: ActivitySession, entry: ActivityEntry): ActivityEntry[] {
  const all = [...readActivity(session), entry]
  session.metadata.setValue(KEY, all.slice(-MAX_ACTIVITY))
  return all.slice(0, -MAX_ACTIVITY)
}

const RUN_FOLDER = 'activity'
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const runFile = (folder: string, run: string): string => {
  if (!RUN_ID.test(run)) throw new RangeError(`"${run}" is not a run`)
  return join(folder, RUN_FOLDER, `${run}.json`)
}

/** Stores what a helper was told and did, beside the session's database: it is bulky, and only read to find out what went wrong. */
export function keepRunDetail(folder: string, run: string, detail: RunDetail): void {
  const file = runFile(folder, run)
  mkdirSync(join(folder, RUN_FOLDER), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(detail))
  renameSync(`${file}.tmp`, file)
}

/** The stored detail of a run, or nothing when it was not kept or has been dropped. */
export function readRunDetail(folder: string, run: string): RunDetail | undefined {
  try { return JSON.parse(readFileSync(runFile(folder, run), 'utf8')) as RunDetail }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export function forgetRunDetails(folder: string, dropped: readonly ActivityEntry[]): void {
  for (const entry of dropped) if (entry.run !== undefined) rmSync(runFile(folder, entry.run), { force: true })
}
