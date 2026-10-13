import { MAX_ACTIVITY, type ActivityEntry } from '../../shared/activity.ts'

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

export function recordActivity(session: ActivitySession, entry: ActivityEntry): void {
  session.metadata.setValue(KEY, [...readActivity(session), entry].slice(-MAX_ACTIVITY))
}
