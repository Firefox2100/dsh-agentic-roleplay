import css from './Switch.module.css'

/**
 * Render a toggle switch. The visual state keys off aria-checked, so it cannot
 * disagree with what assistive technology reads; the label belongs to the site.
 */
export function Switch({ checked, onChange, label, disabled = false, title, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string | undefined
  className?: string | undefined
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={className === undefined ? css.rpSwitch : `${css.rpSwitch} ${className}`}
      onClick={() => { onChange(!checked) }}
    >
      <span className={css.rpThumb} />
    </button>
  )
}
