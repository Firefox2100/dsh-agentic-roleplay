/** Smallest page: when fewer items fit on screen, the page scrolls instead of shrinking. */
export const MIN_PAGE_SIZE = 10

export interface Box {
  width: number
  height: number
}

export interface Paging {
  pageSize: number
  /** True when a page holds more items than fit on screen. */
  scrolls: boolean
}

/** Page by what fits on screen, but never below the minimum page. */
export function pagingFor(fit: number): Paging {
  return fit >= MIN_PAGE_SIZE ? { pageSize: fit, scrolls: false } : { pageSize: MIN_PAGE_SIZE, scrolls: true }
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Index of the first item of the page that contains `index`, never past the last page. */
export function pageStart(index: number, total: number, pageSize: number): number {
  const lastPage = pageCount(total, pageSize) - 1
  return Math.min(Math.floor(Math.max(0, index) / pageSize), lastPage) * pageSize
}
