import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

export interface FoldRange {
  /** The first and last surface nodes to fold into the summary. */
  start: SessionSeq
  end: SessionSeq
  /** The last turn that leaves the conversation. */
  uptoTurn: number
}

/** The turn each event belongs to: the latest turn that had started by then. */
export function turnsOf(events: readonly SessionEvent[]): Map<SessionSeq, number> {
  const turns = new Map<SessionSeq, number>()
  let current = 0
  for (const event of events) {
    if (event.type === 'turn/start') current = (event.data as { turn: number }).turn
    turns.set(event.seq, current)
  }
  return turns
}

const startsTurn = (event: SessionEvent | undefined): boolean =>
  event?.type === 'user/message' && (event.data as { source?: { kind?: string } }).source?.kind === 'user'

/**
 * Chooses what to fold when the conversation is too long: everything before the player
 * message that starts a turn, keeping at least `retainTokens` of the most recent turns
 * as they are. Whole turns only, so no tool call is parted from its result and the
 * summary can say exactly which turns it covers.
 * @returns the range, or `null` when no turn boundary leaves enough to keep.
 */
export function selectFoldRange(input: {
  events: readonly SessionEvent[]
  /** The surface, oldest first, with what each node costs. */
  nodes: readonly { seq: SessionSeq; tokens: number }[]
  retainTokens: number
}): FoldRange | null {
  const { events, nodes, retainTokens } = input
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const first = nodes.length > 0 && bySeq.get(nodes[0]!.seq)?.type === 'system/message' ? 1 : 0
  const turns = turnsOf(events)
  let tail = 0
  const tails = nodes.map(() => 0)
  for (let index = nodes.length - 1; index >= 0; index--) {
    tail += nodes[index]!.tokens
    tails[index] = tail
  }
  for (let index = nodes.length - 1; index > first; index--) {
    if (!startsTurn(bySeq.get(nodes[index]!.seq)) || tails[index]! < retainTokens) continue
    const uptoTurn = (turns.get(nodes[index]!.seq) ?? 0) - 1
    if (uptoTurn < 1) return null
    return { start: nodes[first]!.seq, end: nodes[index - 1]!.seq, uptoTurn }
  }
  return null
}
