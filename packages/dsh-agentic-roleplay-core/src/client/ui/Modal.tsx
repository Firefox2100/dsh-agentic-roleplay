import { useLayoutEffect, useRef, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react'
import { IconClose } from './icons.tsx'
import css from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** Localized label of the close control; ignored while `headless`. */
  closeLabel?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
  /** Renders the children directly in the card, keeping only the mask, Escape and the dialog role. */
  headless?: boolean
  /** Set false when the caller already blurs the page behind the dialog. */
  backdropBlur?: boolean
  /** Handles keys of a nested dialog before the document listener sees them. */
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>
  /** Command scope this dialog names, for shortcut owners; not used by the dialog itself. */
  shortcutModal?: string
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'

interface Layer {
  dialog: HTMLElement
}

/** Open dialogs in mount order: only the last one owns Escape and Tab, so a nested dialog closes alone. */
const layers: Layer[] = []

function topLayer(): Layer | undefined {
  return layers[layers.length - 1]
}

/** Whether an element can still take focus: connected, visible to assistive tech, not inert. */
function focusable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && !element.closest('[inert], [hidden]')
}

/**
 * Whether a dialog belongs to the document that currently has the DOM.
 * Mirrors the browser globals through `globalThis` because the host type check has no DOM lib.
 */
function documents(): Document | undefined {
  const scope = globalThis as { document?: Document }
  return scope.document
}

/**
 * Own Escape and Tab while the dialog is open, focus its first control, and give focus back on close.
 * Focus moves without a visible ring so a pointer user never sees one appear on the invoking control.
 */
function useModalLayer(dialog: RefObject<HTMLDivElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const document = documents()
    const element = dialog.current
    if (!open || document === undefined || element === null) return
    const layer: Layer = { dialog: element }
    layers.push(layer)
    const previous = document.activeElement
    const initial = element.querySelector('[data-modal-autofocus]') ?? element.querySelector(FOCUSABLE) ?? element
    if (!element.contains(document.activeElement) && focusable(initial)) initial.focus({ preventScroll: true })

    const keydown = (event: KeyboardEvent): void => {
      if (topLayer() !== layer) return
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...element.querySelectorAll(FOCUSABLE)].filter(item => !item.closest('[inert], [hidden]'))
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      if (document.activeElement === element || !element.contains(document.activeElement) || atEdge) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        if (focusable(target)) target.focus()
      }
    }
    document.addEventListener('keydown', keydown)

    return () => {
      document.removeEventListener('keydown', keydown)
      const at = layers.indexOf(layer)
      if (at >= 0) layers.splice(at, 1)
      // A dialog that closes under another one leaves focus inside the survivor, which keeps it.
      const top = topLayer()
      if (top !== undefined && !top.dialog.contains(previous)) return
      if (focusable(previous)) previous.focus({ preventScroll: true })
    }
  }, [dialog, open])
}

/**
 * A centered dialog over a blurred mask, rendered where the caller mounts it.
 *
 * It is deliberately not a body portal: the plugin renders inside its own slot subtree, so the mask is
 * fixed to the viewport from there instead of moving DOM outside the slot.
 */
export function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless = false, backdropBlur = true, onKeyDownCapture, shortcutModal }: ModalProps): ReactNode {
  const dialog = useRef<HTMLDivElement>(null)
  useModalLayer(dialog, open, onClose)
  if (!open) return null
  return (
    <div className={css.root} role="presentation" onKeyDownCapture={onKeyDownCapture} data-shortcut-modal={shortcutModal}>
      <div className={css.mask} style={backdropBlur ? undefined : { backdropFilter: 'none' }} aria-hidden="true" onClick={onClose} />
      <div ref={dialog} tabIndex={-1} className={[css.dialog, className].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={title}>
        {headless
          ? children
          : (
              <>
                <div className={[css.content, contentClassName].filter(Boolean).join(' ')}>
                  <div className={css.header}>
                    <h2 className={css.title}>{title}</h2>
                    <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                      <IconClose size={14} />
                    </button>
                  </div>
                  {description !== undefined && description !== '' && <p className={css.description}>{description}</p>}
                  {children !== undefined && <div className={css.body}>{children}</div>}
                </div>
                {footer !== undefined && <div className={css.footer}>{footer}</div>}
              </>
            )}
      </div>
    </div>
  )
}
