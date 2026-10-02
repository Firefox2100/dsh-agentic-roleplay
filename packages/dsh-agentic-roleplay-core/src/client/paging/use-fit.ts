import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Box } from './paging.ts'

/**
 * How many items fit in the element, measured whenever it resizes; 0 until
 * measured. `compute` receives the content box and the element's styles, where
 * item sizes live in custom properties so the stylesheet stays their only source.
 * It must be a stable function.
 */
export function useFit(
  viewport: RefObject<HTMLElement | null>,
  compute: (box: Box, style: CSSStyleDeclaration) => number,
): number {
  const [fit, setFit] = useState(0)
  useLayoutEffect(() => {
    const element = viewport.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setFit(compute({ width: entry.contentRect.width, height: entry.contentRect.height }, getComputedStyle(element)))
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [viewport, compute])
  return fit
}

/** A length custom property in pixels, or undefined when it is not set. */
export function pixels(style: CSSStyleDeclaration, name: string): number | undefined {
  const value = Number.parseFloat(style.getPropertyValue(name))
  return Number.isFinite(value) ? value : undefined
}
