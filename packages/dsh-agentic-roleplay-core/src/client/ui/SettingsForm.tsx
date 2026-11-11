import { useEffect, useRef, type ReactNode } from 'react'
import type { SettingsFormLabels, SettingsFormShell } from './settings-form.ts'
import css from './SettingsForm.module.css'

export type { SettingsFormLabels } from './settings-form.ts'

export interface SettingsFormProps {
  /** The frame's copy. */
  labels: SettingsFormLabels
  /** The form state: availability, writability, and what a save would do. */
  state: SettingsFormShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit; the form calls it when it leaves the page. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * One card's settings form: the read-only notice, the controls, and the save that writes every staged edit.
 * Leaving the page drops the staged edits, so the form discards on unmount and offers no discard control.
 */
export function SettingsForm({ labels, state, onSave, onDiscard, children }: SettingsFormProps): ReactNode {
  const discard = useRef(onDiscard)
  discard.current = onDiscard
  useEffect(() => () => { discard.current() }, [])

  if (!state.available) return <p className={css.unavailable} role="status">{labels.unavailable}</p>
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <div className={css.form}>
      {!state.writable ? <p className={css.readOnly} role="status">{labels.readOnly}</p> : null}
      {children}
      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{labels.saveFailed}</p> : null}
        <button type="button" className={css.save} disabled={blocked} onClick={onSave}>
          {state.saving ? labels.saving : labels.save}
        </button>
      </div>
    </div>
  )
}
