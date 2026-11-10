import { useId, useState, type ReactNode } from 'react'
import type { SettingsFieldState } from './settings-form.ts'
import { IconInfo } from './icons.tsx'
import { Tag } from './Tag.tsx'
import css from './SettingsValueField.module.css'

export interface SettingsValueFieldProps extends SettingsFieldState {
  /** The control's id, which its label points at. */
  id: string
  /** The control's label. */
  label: string
  /** Copy under the control while the draft is accepted. */
  hint?: string | undefined
  /** Copy under the control while the draft is not a value the field accepts. */
  invalidLabel: string
  /** Copy of the badge marking a field the user layer carries. */
  overriddenLabel: string
  /** Copy of the control letting the field re-inherit the composition layer. */
  resetLabel: string
  /** Placeholder for an empty control. */
  placeholder?: string | undefined
  /** Whether the value is a number, which hints at a numeric keyboard. */
  numeric?: boolean | undefined
  /** Copy explaining the field, shown by the help control when present. */
  help?: ReactNode | undefined
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  onReset: () => void
}

/**
 * One settings field: its label, whether the user layer overrides it, the control, and its message.
 * A field shows its effective value, so clearing it and resetting it are the same gesture.
 */
export function SettingsValueField({
  id,
  label,
  hint,
  invalidLabel,
  overriddenLabel,
  resetLabel,
  placeholder,
  numeric = false,
  help,
  disabled,
  text,
  overridden,
  invalid,
  onEdit,
  onReset,
}: SettingsValueFieldProps): ReactNode {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = `${useId()}-help`
  const messageId = `${id}-message`
  return (
    <div className={css.field}>
      <div className={css.head}>
        <div className={css.labelGroup}>
          <label className={css.label} htmlFor={id}>{label}</label>
          {help !== undefined && help !== null && (
            <button
              type="button"
              className={css.helpButton}
              aria-label={label}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => { setHelpOpen(open => !open) }}
            >
              <IconInfo size={12} />
            </button>
          )}
        </div>
        {overridden && (
          <span className={css.badges}>
            <Tag tone="neutral">{overriddenLabel}</Tag>
            <button type="button" className={css.reset} disabled={disabled} onClick={onReset}>{resetLabel}</button>
          </span>
        )}
      </div>
      <input
        id={id}
        className={css.input}
        type="text"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={messageId}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(event) => { onEdit(event.target.value) }}
      />
      <p id={messageId} className={invalid ? css.invalid : css.hint}>{invalid ? invalidLabel : hint}</p>
      {helpOpen && help !== undefined && help !== null && <div id={helpId} className={css.help}>{help}</div>}
    </div>
  )
}
