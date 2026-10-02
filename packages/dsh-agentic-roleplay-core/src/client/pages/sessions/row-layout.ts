import type { Box } from '../../paging/paging.ts'

export interface TableMetrics {
  rowHeight: number
  headerHeight: number
}

/** How many whole rows fit under the header without scrolling. */
export function rowsThatFit(box: Box, { rowHeight, headerHeight }: TableMetrics): number {
  return Math.max(0, Math.floor((box.height - headerHeight) / rowHeight))
}
