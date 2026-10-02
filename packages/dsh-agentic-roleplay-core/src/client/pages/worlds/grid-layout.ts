import type { Box } from '../../paging/paging.ts'

export interface GridMetrics {
  cardWidth: number
  cardHeight: number
  gap: number
}

/** How many whole cards fit in the box without scrolling. */
export function cardsThatFit(box: Box, { cardWidth, cardHeight, gap }: GridMetrics): number {
  const columns = Math.floor((box.width + gap) / (cardWidth + gap))
  const rows = Math.floor((box.height + gap) / (cardHeight + gap))
  return Math.max(0, columns) * Math.max(0, rows)
}
