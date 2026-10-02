/** Smallest page: when fewer cards fit on screen, the page scrolls instead of shrinking. */
export const MIN_PAGE_SIZE = 10

export interface GridMetrics {
  cardWidth: number
  cardHeight: number
  gap: number
}

export interface Box {
  width: number
  height: number
}

/** How many whole cards fit in the box without scrolling. */
export function cardsThatFit(box: Box, { cardWidth, cardHeight, gap }: GridMetrics): number {
  const columns = Math.floor((box.width + gap) / (cardWidth + gap))
  const rows = Math.floor((box.height + gap) / (cardHeight + gap))
  return Math.max(0, columns) * Math.max(0, rows)
}

export interface Paging {
  pageSize: number
  /** True when a page holds more cards than fit on screen. */
  scrolls: boolean
}

export function pagingFor(fit: number): Paging {
  return fit >= MIN_PAGE_SIZE ? { pageSize: fit, scrolls: false } : { pageSize: MIN_PAGE_SIZE, scrolls: true }
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Index of the first card of the page that contains `index`, never past the last page. */
export function pageStart(index: number, total: number, pageSize: number): number {
  const lastPage = pageCount(total, pageSize) - 1
  return Math.min(Math.floor(Math.max(0, index) / pageSize), lastPage) * pageSize
}
