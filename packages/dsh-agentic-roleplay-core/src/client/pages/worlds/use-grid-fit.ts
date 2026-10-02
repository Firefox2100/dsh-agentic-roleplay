import type { RefObject } from 'react'
import { useFit, pixels } from '../../paging/use-fit.ts'
import type { Box } from '../../paging/paging.ts'
import { cardsThatFit } from './grid-layout.ts'

function gridFit(box: Box, style: CSSStyleDeclaration): number {
  const cardWidth = pixels(style, '--rp-card-width')
  const cardHeight = pixels(style, '--rp-card-height')
  const gap = pixels(style, '--rp-card-gap')
  return cardWidth === undefined || cardHeight === undefined || gap === undefined ? 0 : cardsThatFit(box, { cardWidth, cardHeight, gap })
}

/** Number of cards that fit in the element without scrolling; 0 until measured. */
export function useGridFit(viewport: RefObject<HTMLElement | null>): number {
  return useFit(viewport, gridFit)
}
