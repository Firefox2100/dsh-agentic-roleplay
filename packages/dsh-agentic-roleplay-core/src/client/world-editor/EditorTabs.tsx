import type { KeyboardEvent, ReactNode } from 'react'
import css from './CharactersPanel.module.css'

interface EditorTab {
  key: string
  label: string
}

/** Adds expected arrow, Home and End navigation to an existing editor tab strip. */
export function navigateEditorTabs(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || !(event.target instanceof HTMLButtonElement) || event.target.getAttribute('role') !== 'tab') return
  const tablist = event.target.closest<HTMLElement>('[role="tablist"]')
  if (tablist === null || !event.currentTarget.contains(tablist)) return
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const index = tabs.indexOf(event.target)
  const last = tabs.length - 1
  const target = event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
    : event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'Home' ? 0
        : event.key === 'End' ? last
          : undefined
  if (target === undefined || tabs[target] === undefined) return
  event.preventDefault()
  tabs[target].focus()
  tabs[target].click()
}

/** A horizontally scrollable editor tab strip with the keyboard behaviour expected of ARIA tabs. */
export function EditorTabs({ tabs, value, label, onChange, children }: {
  tabs: readonly EditorTab[]
  value: string
  label: string
  onChange: (key: string) => void
  children?: ReactNode
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.defaultPrevented) return
    const last = tabs.length - 1
    const target = event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : undefined
    if (target === undefined || tabs[target] === undefined) return
    event.preventDefault()
    onChange(tabs[target].key)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
  }

  return (
    <div className={css.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          tabIndex={tab.key === value ? 0 : -1}
          className={`${css.tab} ${tab.key === value ? css.tabOn : ''}`}
          onClick={() => { onChange(tab.key) }}
          onKeyDown={(event) => { move(event, index) }}
        >
          {tab.label}
        </button>
      ))}
      {children}
    </div>
  )
}
