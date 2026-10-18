import { NO_TOKENS, addTokens, type TokenCount, type TurnUsage } from '../../shared/usage.ts'

const KEY = 'usage'

interface UsageSession {
  metadata: { getValue(key: string): unknown; setValue(key: string, value: never): void }
}

const isCount = (value: unknown): value is TokenCount => typeof value === 'object' && value !== null
  && ['input', 'cached', 'output'].every(field => typeof (value as Record<string, unknown>)[field] === 'number')

const isUsage = (value: unknown): value is TurnUsage => typeof value === 'object' && value !== null
  && typeof (value as TurnUsage).turn === 'number' && typeof (value as TurnUsage).runs === 'number' && isCount((value as TurnUsage).master) && isCount((value as TurnUsage).helpers)

/** What each turn used, oldest first. The record belongs to the story's state, so taking the story back takes the turns that no longer count with it. */
export function readUsage(session: UsageSession): TurnUsage[] {
  const stored = session.metadata.getValue(KEY)
  return Array.isArray(stored) ? stored.filter(isUsage) : []
}

/** Adds tokens to a turn's record: the game master's own, or a helper's run. */
export function addUsage(session: UsageSession, turn: number, who: 'master' | 'helper', tokens: TokenCount): void {
  const all = readUsage(session)
  const at = all.findIndex(entry => entry.turn === turn)
  const entry: TurnUsage = at === -1 ? { turn, master: NO_TOKENS, helpers: NO_TOKENS, runs: 0 } : all[at]!
  const next: TurnUsage = who === 'master' ? { ...entry, master: addTokens(entry.master, tokens) } : { ...entry, helpers: addTokens(entry.helpers, tokens), runs: entry.runs + 1 }
  if (at === -1) all.push(next)
  else all[at] = next
  all.sort((a, b) => a.turn - b.turn)
  session.metadata.setValue(KEY, all as never)
}
