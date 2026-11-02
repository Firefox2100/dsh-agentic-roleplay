import type { KeyboardEvent } from 'react'
import css from './PageTabs.module.css'

export interface PageTab {
  id: string
  label: string
  /** DOM id of this tab, referenced by its panel. */
  tabId: string
  /** DOM id of the panel this tab controls. */
  panelId: string
}

/** Underlined text tabs; arrow keys, Home and End move between them. */
export function PageTabs({ tabs, value, label, onChange }: {
  tabs: readonly PageTab[]
  value: string
  label: string
  onChange: (id: string) => void
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1
    const targets: Record<string, number> = {
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowRight: index === last ? 0 : index + 1,
      Home: 0,
      End: last,
    }
    const target = targets[event.key]
    const next = target === undefined ? undefined : tabs[target]
    if (target === undefined || next === undefined) return
    event.preventDefault()
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
    onChange(next.id)
  }

  return (
    <div role="tablist" aria-label={label} className={css.tabs}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tab.tabId}
          aria-controls={tab.panelId}
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          className={css.tab}
          onClick={() => { onChange(tab.id) }}
          onKeyDown={(event) => { onKeyDown(event, index) }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
