import { useEffect, useState, type ReactNode } from 'react'
import css from './Toast.module.css'

export interface ToastAction {
  label: string
  prefix?: string
  onClick: () => void
}

export interface ToastProps {
  text: string
  icon?: ReactNode
  tone?: 'success'
  /** Ignored: the plugin's banner is fixed to the viewport rather than to an anchor element. */
  anchor?: unknown
  /** Full-opacity hold before the fade; defaults to 3000ms. */
  holdMs?: number
  actions?: readonly ToastAction[]
  /** Called once the fade completes; unmount the toast here. */
  onDone: () => void
}

const FADE_MS = 200

/**
 * A transient top-center banner: slides in, holds, fades out, then reports done.
 *
 * It stays inside the plugin's own subtree and is fixed to the viewport, so no DOM is moved outside
 * the slot; the stylesheet reads the hold time from a custom property so the fade and the unmount agree.
 */
export function Toast({ text, icon, tone, holdMs = 3000, actions, onDone }: ToastProps): ReactNode {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fade = setTimeout(() => { setFading(true) }, holdMs)
    return () => { clearTimeout(fade) }
  }, [holdMs])

  useEffect(() => {
    if (!fading) return
    const done = setTimeout(onDone, FADE_MS)
    return () => { clearTimeout(done) }
  }, [fading, onDone])

  return (
    <div className={`${css.banner} ${fading ? css.fading : ''}`} style={{ '--rp-toast-hold': `${holdMs}ms` } as never} role="status" aria-live="polite">
      {tone === 'success' ? <span className={css.success} aria-hidden="true">✓</span> : icon}
      <span className={css.text}>{text}</span>
      {actions?.map(action => (
        <span key={action.label} className={css.action}>
          {action.prefix !== undefined && <span className={css.prefix}>{action.prefix}</span>}
          <button type="button" className={css.actionButton} onClick={action.onClick}>{action.label}</button>
        </span>
      ))}
    </div>
  )
}
