import type { RefObject } from 'react'
import type { Box } from '../../paging/paging.ts'
import { pixels, useFit } from '../../paging/use-fit.ts'
import { rowsThatFit } from './row-layout.ts'

function rowFit(box: Box, style: CSSStyleDeclaration): number {
  const rowHeight = pixels(style, '--rp-row-height')
  const headerHeight = pixels(style, '--rp-header-height')
  return rowHeight === undefined || headerHeight === undefined ? 0 : rowsThatFit(box, { rowHeight, headerHeight })
}

/** Number of table rows that fit in the element without scrolling; 0 until measured. */
export function useRowFit(viewport: RefObject<HTMLElement | null>): number {
  return useFit(viewport, rowFit)
}
