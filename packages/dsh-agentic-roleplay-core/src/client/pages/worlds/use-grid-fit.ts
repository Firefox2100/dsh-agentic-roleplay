import { useLayoutEffect, useState, type RefObject } from 'react'
import { cardsThatFit, type GridMetrics } from './grid-layout.ts'

/** The grid's sizes live in CSS custom properties on the viewport, so styles stay the single source. */
function readMetrics(element: HTMLElement): GridMetrics | undefined {
  const style = getComputedStyle(element)
  const px = (name: string): number => Number.parseFloat(style.getPropertyValue(name))
  const metrics = { cardWidth: px('--rp-card-width'), cardHeight: px('--rp-card-height'), gap: px('--rp-card-gap') }
  return Object.values(metrics).every(Number.isFinite) ? metrics : undefined
}

/** Number of cards that fit in the element without scrolling; 0 until measured. */
export function useGridFit(viewport: RefObject<HTMLElement | null>): number {
  const [fit, setFit] = useState(0)
  useLayoutEffect(() => {
    const element = viewport.current
    if (element === null) return
    const measure = (width: number, height: number): void => {
      const metrics = readMetrics(element)
      setFit(metrics === undefined ? 0 : cardsThatFit({ width, height }, metrics))
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) measure(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [viewport])
  return fit
}
