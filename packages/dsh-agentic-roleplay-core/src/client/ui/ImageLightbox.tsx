import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { IconClose } from './icons.tsx'
import css from './ImageLightbox.module.css'

export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

export interface ImageLightboxProps {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
  contextMenuProps?: Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'> | undefined
}

/**
 * A full-viewport original-image preview that closes on Escape, backdrop press or its close control,
 * and gives focus back to the opener when it unmounts. It renders in place, never through a body portal.
 */
export function ImageLightbox({ src, alt, labels, onClose, contextMenuProps }: ImageLightboxProps): ReactNode {
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = (globalThis as { document?: Document }).document?.activeElement
    close.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.shiftKey && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    const document = (globalThis as { document?: Document }).document
    document?.addEventListener('keydown', keydown)
    return () => {
      document?.removeEventListener('keydown', keydown)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [onClose])

  return (
    <div
      className={css.root}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <img className={css.image} src={src} alt={alt} {...contextMenuProps} />
      <button ref={close} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconClose size={16} />
      </button>
    </div>
  )
}
