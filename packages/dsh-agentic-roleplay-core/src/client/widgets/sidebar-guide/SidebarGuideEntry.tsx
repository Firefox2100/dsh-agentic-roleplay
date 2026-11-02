import type { ComponentType, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SidebarGuideEntry.module.css'

/** A card of the right sidebar's new-tab guide, drawn like DSH's own entries. */
export function SidebarGuideEntry({ kind, title, description, icon: Icon, onOpen }: { kind: string; title: string; description: string; icon: ComponentType<{ size?: number }>; onOpen: () => void }): ReactNode {
  return (
    <div className={css.entry} data-sidebar-right-guide-entry={kind}>
      <Button variant="ghost" className={css.main} aria-label={title} onClick={onOpen} />
      <span className={css.icon} aria-hidden="true"><Icon size={26} /></span>
      <span className={css.text}>
        <span className={css.title} aria-hidden="true">{title}</span>
        <span className={css.description} aria-hidden="true">{description}</span>
      </span>
    </div>
  )
}
