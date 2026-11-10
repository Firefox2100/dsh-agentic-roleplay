/** The side a bubble prefers, relative to its anchor. */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

/** The part of a DOM rectangle placement needs; kept structural so tests can pass plain objects. */
export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export interface Placement {
  left: number
  top: number
}

/** Distance the bubble keeps from the viewport edge. */
export const MARGIN = 8

/**
 * The viewport as the page measures it.
 *
 * Read through `globalThis` because the host type-checker sees these client files without the DOM
 * library; `visibility.ts` avoids a bare `document` for the same reason. A caller outside a browser
 * gets zeroes, which {@link place} treats as "not bounded".
 */
export function viewportOf(): Viewport {
  const scope = globalThis as { innerWidth?: number; innerHeight?: number }
  return { width: scope.innerWidth ?? 0, height: scope.innerHeight ?? 0 }
}

/**
 * Where the bubble's left/top edges land for one preferred side: on that side when it fits, flipped
 * to the opposite side when it does not, and clamped into the viewport either way.
 *
 * Without a measured viewport (zero width or height) nothing is flipped or clamped, which keeps the
 * preferred side exact for callers that cannot measure one.
 */
export function place(anchor: AnchorRect, bubble: { width: number; height: number }, side: TooltipSide, gap: number, viewport?: Viewport): Placement {
  const width = viewport?.width ?? 0
  const height = viewport?.height ?? 0
  const bounded = width > 0 && height > 0
  const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))
  const fit = (value: number, size: number, extent: number): number => (bounded ? clamp(value, MARGIN, extent - MARGIN - size) : value)

  if (side === 'left' || side === 'right') {
    let left = side === 'right' ? anchor.right + gap : anchor.left - gap - bubble.width
    if (bounded && (left + bubble.width > width - MARGIN || left < MARGIN)) {
      left = side === 'right' ? anchor.left - gap - bubble.width : anchor.right + gap
    }
    const top = anchor.top + anchor.height / 2 - bubble.height / 2
    return { left: fit(left, bubble.width, width), top: fit(top, bubble.height, height) }
  }

  let top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - bubble.height
  if (bounded && top < MARGIN) top = anchor.bottom + gap
  else if (bounded && top + bubble.height > height - MARGIN) top = anchor.top - gap - bubble.height
  const left = anchor.left + anchor.width / 2 - bubble.width / 2
  return { left: fit(left, bubble.width, width), top: fit(top, bubble.height, height) }
}
