import { useId } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createPanelStore } from './panel-store.ts'
import type { PageMetadata } from './pages-source.ts'
import { PageTabs, type PageTab } from './PageTabs.tsx'
import css from './RoleplayPanel.module.css'
import type {} from './slot-contract.ts'

export interface PanelFace {
  hooks: {
    /** Bound by the renderer as `usePages`. */
    pages: { getSnapshot: () => readonly PageMetadata[]; subscribe: (listener: () => void) => () => void }
  }
}

export type RoleplayPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'roleplay.panel'>
  & PropsRenderSlots<'roleplay.page'>
  & PropsStore<ReturnType<typeof createPanelStore>>
  & InjectFace<PanelFace>

/** Header, page navigation and the selected page. */
export function RoleplayPanel({ t, renderSlot, useStore, actions, usePages }: RoleplayPanelProps) {
  const idBase = useId()
  const pages = usePages(snapshot => snapshot)
  const selected = useStore(state => state.page)
  const active = pages.find(page => page.id === selected) ?? pages[0]
  const tabId = (id: string) => `${idBase}-tab-${id}`
  const panelId = (id: string) => `${idBase}-page-${id}`

  const tabs = pages.map((page): PageTab => ({
    id: page.id,
    label: page.label,
    tabId: tabId(page.id),
    panelId: panelId(page.id),
  }))

  return (
    <section className={css.panel} aria-labelledby={`${idBase}-heading`} data-testid="roleplay-panel">
      <header className={css.header}>
        <h1 id={`${idBase}-heading`} className={css.title}>{t('heading')}</h1>
        {active !== undefined && (
          <PageTabs tabs={tabs} value={active.id} label={t('navLabel')} onChange={(id) => { actions.selectPage(id) }} />
        )}
      </header>
      {active !== undefined && (
        <div
          key={active.id}
          className={css.body}
          role="tabpanel"
          id={panelId(active.id)}
          aria-labelledby={tabId(active.id)}
        >
          {renderSlot('roleplay.page', {}, { only: active.id })}
        </div>
      )}
    </section>
  )
}
