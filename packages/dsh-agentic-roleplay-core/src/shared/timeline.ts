import type { TurnOutput } from './narration.ts'

/**
 * One turn that was played: what the player said, what came out of it, and the log events that carry it.
 * The turns form a tree: a turn is played from the state its parent left, and several can follow the same one
 * (a regenerated turn, or what was said instead after a rewind). The head is the turn the story stands at now.
 */
export interface TimelineNode {
  id: string
  /** The turn this one follows; none for the first. */
  parent: string | null
  /** The turn's number in the chat's log. */
  turn: number
  /** The log seq of the player's message, and of the last event of the turn once it ended. */
  userSeq: number
  endSeq?: number
  /** Where the turn begins in the log, which is at or before the message; the rows of the transcript that belong to the turn start here. */
  startSeq?: number
  player: string
  /** What was delivered, once it was. */
  output?: TurnOutput
  /** The snapshot of the story's state after the turn settled, once taken; without it the turn cannot be returned to. */
  snapshot?: string
  /** Where the turn stands on the model's conversation when it is told as a notice instead of by its own events. */
  noticeSeq?: number
  createdAt: string
}

export interface Timeline {
  version: 1
  /** The turn the story stands at; none before the first. */
  head: string | null
  /** The number of the next turn's id. */
  next: number
  nodes: TimelineNode[]
}

export const emptyTimeline = (): Timeline => ({ version: 1, head: null, next: 1, nodes: [] })

/** The turns from the first to `id`, in order; none for the start. */
export function pathTo(timeline: Pick<Timeline, 'nodes'>, id: string | null): TimelineNode[] {
  const byId = new Map(timeline.nodes.map(node => [node.id, node]))
  const path: TimelineNode[] = []
  for (let at = id === null ? undefined : byId.get(id); at !== undefined; at = at.parent === null ? undefined : byId.get(at.parent)) path.unshift(at)
  return path
}

/** The turns that follow `parent`, in the order they were played. */
export const childrenOf = (timeline: Pick<Timeline, 'nodes'>, parent: string | null): TimelineNode[] => timeline.nodes.filter(node => node.parent === parent)

/** The snapshot that holds the state before any turn. */
export const START_SNAPSHOT = 'start'
/** The snapshot that holds the state after a turn. */
export const snapshotOf = (id: string): string => `after-${id}`

/** What the client is told of a session's turns. */
export interface TimelineView {
  head: string | null
  /** The turns from the first to the head. */
  path: TimelineTurn[]
  /** The turns that can be gone forward to from the head, when the story was taken back. */
  forward: TimelineTurn[]
  /** Whether the state before the first turn can be gone back to. */
  canStart: boolean
  /** The stretches of the log, by seq, that belong to turns the story is not at: the transcript leaves their rows out. */
  withdrawn: { from: number; to: number }[]
}

export interface TimelineTurn {
  id: string
  turn: number
  player: string
  output?: TurnOutput
  /** The log seq the turn ended at: where a branch of the story after this turn is cut. */
  endSeq?: number
  /** Whether the story can be taken here: its state was kept. */
  restorable: boolean
  /** The turns played from the same state, this one included, in the order played; with more than one, one can be swapped for another. */
  alternatives: string[]
}

/** Builds what the client shows from the timeline. */
export function viewOf(timeline: Timeline): TimelineView {
  const turn = (node: TimelineNode): TimelineTurn => ({
    id: node.id, turn: node.turn, player: node.player, ...(node.endSeq === undefined ? {} : { endSeq: node.endSeq }), ...(node.output === undefined ? {} : { output: node.output }),
    restorable: node.snapshot !== undefined, alternatives: childrenOf(timeline, node.parent).map(sibling => sibling.id),
  })
  const on = new Set(pathTo(timeline, timeline.head).map(node => node.id))
  const withdrawn = timeline.nodes.filter(node => !on.has(node.id) && node.userSeq >= 0).map(node => ({ from: Math.min(node.startSeq ?? node.userSeq, node.userSeq), to: node.endSeq ?? Number.MAX_SAFE_INTEGER }))
  return { head: timeline.head, path: pathTo(timeline, timeline.head).map(turn), forward: childrenOf(timeline, timeline.head).map(turn), canStart: true, withdrawn }
}

/** Where a notice stands for a turn that is not told by its own events: the player's words and what was delivered, as plain text. */
export function noticeText(node: Pick<TimelineNode, 'player' | 'output'>): string {
  const told = node.output === undefined ? '(nothing was delivered)' : node.output.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}: "${segment.text}"` : segment.text)).join('\n')
  const ruling = node.output?.ooc === undefined ? '' : `\nThe command was ruled ${node.output.ooc.legal ? 'legal' : 'illegal and refused'}: ${node.output.ooc.note}`
  return `The story, as it went earlier (restored):\nThe player said: ${node.player}${ruling}\nIt was told to the player:\n${told}`
}
