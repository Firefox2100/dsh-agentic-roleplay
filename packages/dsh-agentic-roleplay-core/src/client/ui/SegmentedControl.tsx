import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import css from './SegmentedControl.module.css'
import { isWalkKey, walk } from './walk.ts'

/** The document as the host type-checker sees it: `visibility.ts` avoids a bare `document` for the same reason. */
function focusedWithin(root: HTMLElement): boolean {
  const view = globalThis as { document?: { activeElement?: object | null } }
  const active = view.document?.activeElement
  return active !== undefined && active !== null && root.contains(active as never)
}

/** One segment of a {@link SegmentedControl}. */
export interface SegmentedControlOption<Value extends string> {
  value: Value
  label: string
  disabled?: boolean
  title?: string
}

/**
 * Render a segmented control as a tablist: each tab is `<id>-<value>` and names
 * `<id>-<value>-panel`; arrow keys and Home/End walk the enabled segments.
 */
export function SegmentedControl<Value extends string>({ id, value, options, onChange, label, disabled = false, className }: {
  id: string
  value: Value
  options: readonly SegmentedControlOption<Value>[]
  onChange: (next: Value) => void
  label: string
  disabled?: boolean
  className?: string | undefined
}) {
  const list = useRef<HTMLDivElement>(null)
  const selected = options.findIndex(option => option.value === value)
  useEffect(() => {
    const root = list.current
    if (root === null) return
    if (!focusedWithin(root)) return
    const active = root.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
    active?.focus()
  }, [value])
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isWalkKey(event.key)) return
    event.preventDefault()
    const target = walk(options, selected, event.key)
    if (target !== undefined && target.value !== value) onChange(target.value)
  }
  const indicator = {
    '--rp-segment-count': String(options.length),
    '--rp-segment-index': String(selected),
  } as CSSProperties
  return (
    <div ref={list} role="tablist" aria-label={label} className={className === undefined ? css.rpControl : `${css.rpControl} ${className}`} style={indicator}>
      <span aria-hidden="true" className={css.rpIndicator} />
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${id}-${option.value}-panel`}
            tabIndex={active ? 0 : -1}
            disabled={disabled || option.disabled === true}
            title={option.title}
            className={css.rpTab}
            onClick={() => { if (!active) onChange(option.value) }}
            onKeyDown={onKeyDown}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
