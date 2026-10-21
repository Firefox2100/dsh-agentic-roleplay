import { START_SNAPSHOT, type Timeline } from '../../shared/timeline.ts'

export interface Branch {
  /** The turns the branch has: the ones that ended in the part of the log it inherits. */
  timeline: Timeline
  /** The state the branch starts from: a snapshot, or the live state of the story when its last turn has none yet. */
  from: { snapshot: string } | { live: true }
  /** The snapshots the branch keeps. */
  keep: string[]
}

export class BranchError extends Error {}

/**
 * What a branch of a story cut at a log event keeps of the timeline: the turns that ended at or before it, standing at the one
 * that ended last, and the state of the story after that turn.
 * @param boundary - the seq of the last event the branch inherits.
 * @param snapshots - the names of the snapshots the story has.
 * @throws {BranchError} when the state at that point was not kept.
 */
export function branchTimeline(timeline: Timeline, boundary: number, snapshots: readonly string[]): Branch {
  const nodes = timeline.nodes.filter(node => node.endSeq !== undefined && node.endSeq <= boundary).map(node => ({ ...node }))
  for (const node of nodes) if (node.noticeSeq !== undefined && node.noticeSeq > boundary) delete node.noticeSeq
  const last = nodes.reduce<(typeof nodes)[number] | undefined>((found, node) => (found === undefined || node.endSeq! > found.endSeq! ? node : found), undefined)
  const available = new Set(snapshots)
  for (const node of nodes) if (node.snapshot !== undefined && !available.has(node.snapshot)) delete node.snapshot
  const keep = [...nodes.flatMap(node => (node.snapshot === undefined ? [] : [node.snapshot])), ...(available.has(START_SNAPSHOT) ? [START_SNAPSHOT] : [])]
  const branch: Timeline = { version: 1, head: last?.id ?? null, next: timeline.next, nodes }
  if (last === undefined) {
    if (!available.has(START_SNAPSHOT)) throw new BranchError('the state at the start of the story was not kept, so it cannot be branched')
    return { timeline: branch, from: { snapshot: START_SNAPSHOT }, keep }
  }
  if (last.snapshot !== undefined) return { timeline: branch, from: { snapshot: last.snapshot }, keep }
  if (timeline.head === last.id) return { timeline: branch, from: { live: true }, keep }
  throw new BranchError(`the state of the story after its turn ${last.turn} was not kept, so it cannot be branched there`)
}

/** The name of a branch: the story's name with its trailing number counted up, or a 2 added. */
export function branchName(name: string): string {
  const trimmed = name.trimEnd()
  let start = trimmed.length
  while (start > 0 && trimmed.charCodeAt(start - 1) >= 48 && trimmed.charCodeAt(start - 1) <= 57) start -= 1
  const next = start === trimmed.length ? `${name} 2` : `${trimmed.slice(0, start)}${Number(trimmed.slice(start)) + 1}`
  return next.length > 200 ? `${[...name].slice(0, 190).join('').trimEnd()} 2` : next
}
