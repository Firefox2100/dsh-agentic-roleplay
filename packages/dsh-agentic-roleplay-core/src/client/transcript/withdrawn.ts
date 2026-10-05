export interface NodeLike {
  key?: string
  anchorSeq?: number
}

/** The rows of the transcript that belong to turns the story is not at, by the key DSH gives each row. */
export function withdrawnKeys(nodes: Iterable<NodeLike>, withdrawn: readonly { from: number; to: number }[]): string[] {
  if (withdrawn.length === 0) return []
  return [...nodes].flatMap(node => (node.key !== undefined && node.anchorSeq !== undefined && withdrawn.some(range => node.anchorSeq! >= range.from && node.anchorSeq! <= range.to) ? [node.key] : []))
}

