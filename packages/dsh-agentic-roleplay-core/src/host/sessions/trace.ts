import { MAX_TRACES, type TurnTrace } from '../../shared/trace.ts'

const KEY = 'trace'

interface TraceSession {
  metadata: { getValue(key: string): unknown; setValue(key: string, value: never): void }
}

const isTrace = (value: unknown): value is TurnTrace => typeof value === 'object' && value !== null
  && typeof (value as TurnTrace).turn === 'number' && typeof (value as TurnTrace).startedAt === 'number'

/** What the story kept of each turn's work, oldest first. It belongs to the story's state, so taking the story back takes the turns that no longer count with it. */
export function readTraces(session: TraceSession): TurnTrace[] {
  const stored = session.metadata.getValue(KEY)
  return Array.isArray(stored) ? stored.filter(isTrace) : []
}

/** Adds to a turn's trace what one source of it knows; the sources (the characters' briefs, the scene, the log at the end of the turn) arrive at different times. */
export function updateTrace(session: TraceSession, turn: number, patch: Partial<Omit<TurnTrace, 'turn'>>, merge?: (current: TurnTrace) => Partial<Omit<TurnTrace, 'turn'>>): void {
  const all = readTraces(session)
  const at = all.findIndex(entry => entry.turn === turn)
  const current: TurnTrace = at === -1 ? { turn, startedAt: 0 } : all[at]!
  const next: TurnTrace = { ...current, ...patch, ...merge?.(current) }
  if (at === -1) all.push(next)
  else all[at] = next
  all.sort((a, b) => a.turn - b.turn)
  session.metadata.setValue(KEY, all.slice(-MAX_TRACES) as never)
}
