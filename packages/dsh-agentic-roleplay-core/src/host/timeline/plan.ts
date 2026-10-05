import { pathTo, type Timeline, type TimelineNode } from '../../shared/timeline.ts'

/** A run of consecutive nodes of the model's conversation that is to be replaced by a marker. */
export interface ShadowRun {
  startSeq: number
  endSeq: number
  seqs: number[]
}

export interface MovePlan {
  /** What on the model's conversation does not belong to the turns that stay, so that the next request no longer carries it. */
  shadow: ShadowRun[]
  /** The turns that stay on the conversation by their own events. */
  kept: string[]
  /** The turns that have to be told again, as notices, in order: the story is taken to turns that are no longer on the conversation. */
  inject: TimelineNode[]
}

/**
 * Where the model's conversation has to be changed so that it carries the turns from the first to `target`, and no others.
 * A turn is on the conversation when its own message is, or the notice that stands for it. The turns that stay are the longest
 * run from the first that is on it; whatever else of the timeline is on it is shadowed, and the rest of the way is told by notices.
 * @param surface - the seqs of the model's conversation, in order.
 */
export function planMove(timeline: Timeline, target: string | null, surface: readonly number[]): MovePlan {
  const onSurface = new Set(surface)
  const path = pathTo(timeline, target)
  let keptCount = 0
  let last = -1
  for (const node of path) {
    const at = surface.indexOf(node.userSeq)
    if (at <= last) break
    last = at
    keptCount += 1
  }
  const kept = path.slice(0, keptCount)
  const keptIds = new Set(kept.map(node => node.id))
  const byStart = [...timeline.nodes].sort((a, b) => a.userSeq - b.userSeq)
  const seqs = new Set<number>()
  byStart.forEach((node, index) => {
    if (keptIds.has(node.id)) return
    if (node.noticeSeq !== undefined && onSurface.has(node.noticeSeq)) seqs.add(node.noticeSeq)
    if (!onSurface.has(node.userSeq)) return
    const end = node.endSeq ?? (byStart[index + 1]?.userSeq === undefined ? Infinity : byStart[index + 1]!.userSeq - 1)
    for (const seq of surface) if (seq >= node.userSeq && seq <= end) seqs.add(seq)
  })
  const shadow: ShadowRun[] = []
  let run: number[] = []
  let previous = -2
  surface.forEach((seq, index) => {
    if (!seqs.has(seq)) return
    if (index !== previous + 1 && run.length > 0) { shadow.push({ startSeq: run[0]!, endSeq: run.at(-1)!, seqs: run }); run = [] }
    run.push(seq)
    previous = index
  })
  if (run.length > 0) shadow.push({ startSeq: run[0]!, endSeq: run.at(-1)!, seqs: run })
  return { shadow, kept: kept.map(node => node.id), inject: path.slice(keptCount) }
}
