import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEventHandler, type MouseEventHandler, type PointerEventHandler, type ReactElement, type ReactNode } from 'react'
import css from './Tooltip.module.css'
import { place, viewportOf, type Placement, type TooltipSide } from './place.ts'

export type { TooltipSide }

export interface TooltipProps {
  /** Bubble text, or a resolver evaluated only while the bubble is visible. */
  label: string | (() => string)
  side?: TooltipSide
  delayMs?: number
  focusDelayMs?: number
  gap?: number
  disabled?: boolean
  /** Accepted for compatibility; the plugin renders the bubble in place, never under `document.body`. */
  portal?: boolean
  maxWidth?: number
  openOnClick?: boolean
  children: ReactElement<AnchorProps>
}

interface AnchorProps {
  'aria-describedby'?: string | undefined
  ref?: unknown
  onPointerEnter?: PointerEventHandler | undefined
  onPointerLeave?: PointerEventHandler | undefined
  onPointerDown?: PointerEventHandler | undefined
  onClick?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

/** Resolves the tooltip label once the bubble is about to show. */
function textOf(label: string | (() => string)): string {
  return typeof label === 'function' ? label() : label
}

/**
 * Attach a hover/focus explanation to one anchor element.
 *
 * The bubble is `position: fixed` and placed from the anchor's measured rectangle, so an ancestor's
 * `overflow: hidden` cannot clip it while no DOM leaves the plugin's own subtree.
 */
export function Tooltip({ label, side = 'top', delayMs = 0, focusDelayMs = 0, gap = 8, disabled = false, maxWidth, openOnClick = false, children }: TooltipProps): ReactNode {
  const anchor = useRef<HTMLElement | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [shown, setShown] = useState(false)
  const [placed, setPlaced] = useState<Placement | undefined>(undefined)
  const [pinned, setPinned] = useState(false)

  const clear = useCallback((): void => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  const show = useCallback((delay: number): void => {
    if (disabled) return
    clear()
    timer.current = setTimeout(() => { setShown(true) }, delay)
  }, [clear, disabled])

  const hide = useCallback((): void => {
    clear()
    setShown(false)
    setPinned(false)
  }, [clear])

  useEffect(() => clear, [clear])
  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  useLayoutEffect(() => {
    if (!shown) {
      setPlaced(undefined)
      return
    }
    const element = anchor.current
    const box = bubble.current
    if (element === null || box === null) return
    const next = place(element.getBoundingClientRect(), box.getBoundingClientRect(), side, gap, viewportOf())
    setPlaced(current => (current !== undefined && current.left === next.left && current.top === next.top ? current : next))
  }, [shown, side, gap])

  // Re-place the bubble when the page scrolls or resizes while it is visible.
  useEffect(() => {
    if (!shown) return
    const scope = globalThis as {
      addEventListener?: (type: string, listener: () => void, options?: boolean) => void
      removeEventListener?: (type: string, listener: () => void, options?: boolean) => void
    }
    const reflow = (): void => {
      const element = anchor.current
      const box = bubble.current
      if (element === null || box === null) return
      setPlaced(place(element.getBoundingClientRect(), box.getBoundingClientRect(), side, gap, viewportOf()))
    }
    scope.addEventListener?.('resize', reflow)
    scope.addEventListener?.('scroll', reflow, true)
    return () => {
      scope.removeEventListener?.('resize', reflow)
      scope.removeEventListener?.('scroll', reflow, true)
    }
  }, [shown, side, gap])

  const anchorProps: AnchorProps = {
    ref: anchor,
    onPointerEnter: event => { children.props.onPointerEnter?.(event); show(delayMs) },
    onPointerLeave: event => { children.props.onPointerLeave?.(event); hide() },
    onPointerDown: event => { children.props.onPointerDown?.(event); hide() },
    onClick: event => {
      children.props.onClick?.(event)
      if (!openOnClick) {
        hide()
        return
      }
      if (pinned) hide()
      else {
        setShown(true)
        setPinned(true)
      }
    },
    onFocus: event => { children.props.onFocus?.(event); show(focusDelayMs) },
    onBlur: event => { children.props.onBlur?.(event); hide() },
  }

  return (
    <>
      {cloneElement(children, anchorProps)}
      {shown && (
        <div
          ref={bubble}
          role="tooltip"
          className={css.bubble}
          style={{
            left: placed?.left ?? 0,
            top: placed?.top ?? 0,
            maxWidth: maxWidth === undefined ? 'min(320px, calc(100vw - 16px))' : `min(${maxWidth}px, calc(100vw - 16px))`,
            visibility: placed === undefined ? 'hidden' : 'visible',
          }}
        >
          {textOf(label)}
        </div>
      )}
    </>
  )
}
