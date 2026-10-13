import type { Session } from '@dsh-agentic-roleplay/state'

const KEY = 'triggers.judged'

/** What a model judged of a statement, and in which turn. */
export type Verdict = { holds: boolean; turn: number }

type VerdictSession = Pick<Session, 'metadata'>

export function readVerdicts(session: VerdictSession): Record<string, Verdict> {
  const stored = session.metadata.getValue(KEY)
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const verdicts: Record<string, Verdict> = {}
  for (const [statement, value] of Object.entries(stored)) {
    const verdict = value as Partial<Verdict> | null
    if (typeof verdict === 'object' && verdict !== null && typeof verdict.holds === 'boolean' && typeof verdict.turn === 'number') verdicts[statement] = { holds: verdict.holds, turn: verdict.turn }
  }
  return verdicts
}

/** Keeps the verdicts of the given statements as they stand and drops every other: a statement no trigger waits on is no longer judged. */
export function writeVerdicts(session: VerdictSession, verdicts: Record<string, Verdict>, keep: ReadonlySet<string>): void {
  session.metadata.setValue(KEY, Object.fromEntries(Object.entries(verdicts).filter(([statement]) => keep.has(statement))))
}

/** For `runTriggers`: a statement is true when its last verdict says so, and false when nobody judged it. */
export const verdictReader = (session: VerdictSession): ((statement: string) => boolean) => {
  const verdicts = readVerdicts(session)
  return statement => verdicts[statement]?.holds === true
}
