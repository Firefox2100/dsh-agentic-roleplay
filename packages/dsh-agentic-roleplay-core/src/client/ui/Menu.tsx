import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import css from './Menu.module.css'

export type MenuEntry = { key: string; label: string; disabled?: boolean; title?: string | undefined } | { heading: string }

interface MenuProps {
  /** The trigger's text. */
  label: string
  entries: readonly MenuEntry[]
  onSelect: (key: string) => void
  /** The class of the trigger, so that it looks like the buttons beside it. */
  triggerClassName: string
  title?: string | undefined
  disabled?: boolean
}

const GAP = 4
const MARGIN = 8

/**
 * A button that opens a list of choices, drawn with the theme's own colours (a native select takes the browser's, which does not follow a dark theme). The list is placed from the trigger's
 * rectangle on the side with more room, kept inside the window, and closes on a choice, Escape, a click elsewhere, or when the page moves.
 */
export function Menu({ label, entries, onSelect, triggerClassName, title, disabled = false }: MenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | undefined>()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const close = useCallback((refocus: boolean) => { setOpen(false); setPlace(undefined); if (refocus) trigger.current?.focus() }, [])

  useLayoutEffect(() => {
    if (!open || trigger.current === null) return
    const box = trigger.current.getBoundingClientRect()
    const above = box.top - MARGIN
    const below = window.innerHeight - box.bottom - MARGIN
    const up = above > below
    const width = list.current?.offsetWidth ?? 240
    const left = Math.max(MARGIN, Math.min(box.left, window.innerWidth - width - MARGIN))
    setPlace(up ? { left, bottom: window.innerHeight - box.top + GAP, maxHeight: Math.max(120, above - GAP) } : { left, top: box.bottom + GAP, maxHeight: Math.max(120, below - GAP) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (list.current?.contains(target) === true || trigger.current?.contains(target) === true) return
      close(false)
    }
    const away = (): void => { close(false) }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open, close])

  useEffect(() => {
    if (place !== undefined) list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [place])

  const move = (from: HTMLElement, step: number): void => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const at = buttons.indexOf(from as HTMLButtonElement)
    buttons[(at + step + buttons.length) % buttons.length]?.focus()
  }

  return (
    <>
      <button ref={trigger} type="button" className={triggerClassName} disabled={disabled} {...(title === undefined ? {} : { title })} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (open) close(false); else setOpen(true) }}>
        {label} <span aria-hidden="true" className={css.chevron}>▾</span>
      </button>
      {open && createPortal(
        <div
          ref={list}
          className={css.list}
          role="menu"
          style={{ left: place?.left ?? 0, ...(place?.top === undefined ? {} : { top: place.top }), ...(place?.bottom === undefined ? {} : { bottom: place.bottom }), maxHeight: place?.maxHeight ?? 320, visibility: place === undefined ? 'hidden' : 'visible' }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(true) }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.target as HTMLElement, event.key === 'ArrowDown' ? 1 : -1) }
          }}
        >
          {entries.map((entry, index) => 'heading' in entry
            ? <div key={`heading-${index}`} className={css.heading} role="presentation">{entry.heading}</div>
            : <button key={entry.key} type="button" role="menuitem" className={css.item} disabled={entry.disabled === true} {...(entry.title === undefined ? {} : { title: entry.title })} onClick={() => { close(true); onSelect(entry.key) }}>{entry.label}</button>)}
        </div>,
        document.body,
      )}
    </>
  )
}
