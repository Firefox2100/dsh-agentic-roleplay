import { useEffect, useRef, type ReactNode } from 'react'
import type { SettingsFormShell } from './settings-form.ts'
import css from './SettingsForm.module.css'

/** The copy the form frame renders, from the owning plugin's dictionary. */
export interface SettingsFormLabels {
  /** Shown in place of the controls while the namespace is not served. */
  unavailable: string
  /** Shown over the controls while the document is read-only. */
  readOnly: string
  /** Shown beside the save after a save the Host did not accept. */
  saveFailed: string
  /** The save control. */
  save: string
  /** The save control while a save is crossing the wire. */
  saving: string
}

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
