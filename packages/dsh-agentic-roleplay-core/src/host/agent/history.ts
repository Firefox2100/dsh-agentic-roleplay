import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { NarrationSegment } from '../../shared/narration.ts'
import { pathTo, type Timeline } from '../../shared/timeline.ts'
import { appendEmptyTurn, appendNarratedTurn, type TurnSeqs } from './opening.ts'

/** The unknown seq of a turn that is not in the log. */
const NOT_IN_LOG = -1

export interface RebuiltChat {
  events: readonly SessionEvent[]
  /** Where each turn on the way to the head stands in the rebuilt log. */
  seqs: ReadonlyMap<string, TurnSeqs>
}

/**
 * The log of a chat made again from what the session folder keeps: the opening, then each turn from the first to the head as the player
 * said it and as it was delivered. The turns keep their numbers, so the story's own records (written under those numbers) and the next
 * turn agree with the log. The model's tool traffic is not kept; the story's state is in the database, not in the conversation.
 */
export function rebuildChat(opening: readonly NarrationSegment[], timeline: Timeline): RebuiltChat {
  const session = Session.create(SessionId('rebuilt'))
  appendNarratedTurn(session, 1, { segments: [...opening], repaired: false })
  const seqs = new Map<string, TurnSeqs>()
  let last = 1
  for (const node of pathTo(timeline, timeline.head)) {
    if (node.output === undefined) continue
    // The log wants consecutive turns, and a turn the story left (a regenerated one) is not on the way to the head: it stays as an empty turn.
    for (let skipped = last + 1; skipped < node.turn; skipped += 1) appendEmptyTurn(session, skipped)
    seqs.set(node.id, appendNarratedTurn(session, node.turn, node.output, node.player))
    last = node.turn
  }
  return { events: session.snapshotEvents(), seqs }
}

/** The timeline with its turns pointed at the rebuilt log; a turn the log does not hold is marked as not in it. */
export function repointTimeline(timeline: Timeline, seqs: ReadonlyMap<string, TurnSeqs>): Timeline {
  return {
    ...timeline,
    nodes: timeline.nodes.map(({ startSeq: _start, endSeq: _end, noticeSeq: _notice, ...node }) => {
      const at = seqs.get(node.id)
      return at === undefined
        ? { ...node, userSeq: NOT_IN_LOG }
        : { ...node, userSeq: at.userSeq ?? NOT_IN_LOG, startSeq: at.startSeq, endSeq: at.endSeq }
    }),
  }
}

export const OPENING_FILE = 'opening.json'

/** What a story opens with when its world gives no opening: a chat with nothing in it is DSH's start screen, which has none of the story's tabs. */
export const DEFAULT_OPENING = 'The story begins.'

/** Keeps the opening in the session folder: it is not in the database, and a chat made again must begin with it. */
export function writeOpening(folder: string, opening: readonly NarrationSegment[]): void {
  const target = join(folder, OPENING_FILE)
  writeFileSync(`${target}.writing`, JSON.stringify(opening))
  renameSync(`${target}.writing`, target)
}

/** The opening a session began with, or nothing for a session made before it was kept. */
export function readOpening(folder: string): NarrationSegment[] | undefined {
  try {
    return JSON.parse(readFileSync(join(folder, OPENING_FILE), 'utf8')) as NarrationSegment[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
