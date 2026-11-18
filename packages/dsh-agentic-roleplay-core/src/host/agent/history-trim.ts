import { freezeMessage, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'

/** A result shorter than this is left as it is: a stub would hardly be smaller, and every change makes the server read the conversation again from that point. */
export const MIN_TRIM_CHARS = 800

export interface Trimmed { count: number; chars: number }

const stubText = (name: string | undefined, chars: number): string =>
  `[The result${name === undefined ? '' : ` of ${name}`} was left out to keep the conversation short (${chars} characters). Call the tool again if you need it.]`

/**
 * Replaces the model-facing text of the tool results of earlier turns with a short note. The log keeps the original (the replacement cites it), and the assistant's own words and its
 * calls stay: a result is mostly the state of the world as it was then, which the next read gives again. Only the turns more than `keepTurns - 1` before `currentTurn` are touched,
 * so one turn changes at the start of each turn and the conversation before it stays as the server has it cached.
 * @param keepTurns how many turns, counting the current one, keep their results; 0 or less keeps all of them.
 * @param estimate the token meter's price of a message, so that pure consumers can subtract what was replaced.
 */
export function trimOldResults(session: Session, currentTurn: number, keepTurns: number, estimate?: (message: Message) => number): Trimmed {
  const done: Trimmed = { count: 0, chars: 0 }
  if (keepTurns <= 0) return done
  const lastTrimmed = currentTurn - keepTurns
  const names = new Map<string, string>()
  for (const event of session.snapshotEvents()) if (event.type === 'tool/call') names.set(String(event.data.callId), event.data.name)
  for (const seq of [...session.surface.nodes]) {
    const event = session.eventAt(seq)
    if (event?.type !== 'tool/result' || event.data.turn > lastTrimmed) continue
    const original = session.deriveEventMessage(event) as ToolResultMessage | null
    if (original === null || original.isError === true || original.content.some(block => block.type !== 'text')) continue
    const chars = original.content.reduce((sum, block) => sum + (block.type === 'text' ? Array.from(block.text).length : 0), 0)
    if (chars < MIN_TRIM_CHARS) continue
    const message = freezeMessage<ToolResultMessage>({ ...original, content: [{ type: 'text', text: stubText(names.get(String(original.toolCallId)), chars) }] })
    if (estimate !== undefined) session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: estimate(original) })
    session.append('tool/result', { ...event.data, message }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
    done.count += 1
    done.chars += chars
  }
  return done
}
