import { useId, useState, type ReactNode } from 'react'
import { Button, IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { PageTabs } from '../widgets/page-tabs/PageTabs.tsx'
import { SidebarGuideEntry } from '../widgets/sidebar-guide/SidebarGuideEntry.tsx'
import type { ListedEntry } from '../widgets/slot-list/slot-list.ts'
import type {} from './slot-contract.ts'
import css from './ReferenceTab.module.css'

/** The kind of the tab type, and the identity it registers its card and body under. */
export const REFERENCE_KIND = 'roleplay-reference'
export const REFERENCE_ID = '@dsh-agentic-roleplay/core/reference-sidebar'

export interface ReferenceFace {
  hooks: {
    /** Bound by the renderer as `useSections`. */
    sections: { getSnapshot: () => readonly ListedEntry[]; subscribe: (listener: () => void) => () => void }
  }
}

export type ReferenceBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'roleplay.reference'> & PropsRenderSlots<'roleplay.reference.section'> & InjectFace<ReferenceFace> & { sessionId: string }
export type ReferenceGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'roleplay.reference'> & { sessionId: string }

/** The guide entry that opens the reference; only a roleplay chat has it. */
export function ReferenceGuide({ sessionId, useTabInfo, t }: ReferenceGuideProps): ReactNode {
  const { tab } = useTabInfo()
  if (roleplaySessionOf(sessionId) === undefined) return null
  return <SidebarGuideEntry kind={REFERENCE_KIND} title={t('title')} description={t('description')} icon={IconListPenOutlineRegular} onOpen={() => { tab.actions.openTab(REFERENCE_KIND, { replaceTab: true }) }} />
}

/** What the player may look up beside the story, one page at a time; a page is an entry of `roleplay.reference.section`. */
export function ReferenceBody({ sessionId, useTabInfo, useSections, renderSlot, t }: ReferenceBodyProps): ReactNode {
  const base = useId()
  const { tab } = useTabInfo()
  const sections = useSections(snapshot => snapshot)
  const [selected, setSelected] = useState<string>()
  const active = sections.find(section => section.id === selected) ?? sections[0]
  const tabs = sections.map(section => ({ id: section.id, label: section.label, tabId: `${base}-tab-${section.id}`, panelId: `${base}-page-${section.id}` }))
  return (
    <div className={css.page}>
      <div className={css.bar}>
        <Button variant="ghost" size="sm" onClick={() => { tab.actions.openTab('guide', { replaceTab: true }) }}>← {t('back')}</Button>
      </div>
      {roleplaySessionOf(sessionId) === undefined
        ? <p className={css.message}>{t('notRoleplay')}</p>
        : (
          <>
            {active !== undefined && <div className={css.nav}><PageTabs tabs={tabs} value={active.id} label={t('navLabel')} onChange={setSelected} /></div>}
            {active !== undefined && (
              <div key={active.id} className={css.body} role="tabpanel" id={`${base}-page-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`}>
                {renderSlot('roleplay.reference.section', { sessionId, visible: tab.visible }, { only: active.id })}
              </div>
            )}
          </>
        )}
    </div>
  )
}
