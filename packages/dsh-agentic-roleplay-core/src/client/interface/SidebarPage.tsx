import type { ReactNode } from 'react'
import { Button, IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { usePack, usePlayerView } from './hooks.ts'
import { PackFrame, type FrameInput } from './PackFrame.tsx'
import css from './SidebarPage.module.css'

/** The kind of the tab type, and the identity it registers its card and body under. */
export const SIDEBAR_KIND = 'roleplay-pack'
export const SIDEBAR_ID = '@dsh-agentic-roleplay/core/interface-sidebar'

export interface SidebarInjected {
  frameInput: FrameInput
}

export type SidebarBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'roleplay.interface'> & InjectFace<SidebarInjected> & { sessionId: string }
export type SidebarGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'roleplay.interface'> & { sessionId: string }

/**
 * The entry of the guide page of the right sidebar that opens the pack's own page, drawn like the entries of DSH's own
 * pages. It is there only for a story whose pack has such a page, so an ordinary chat's guide is left as it was.
 */
export function SidebarGuide({ sessionId, useTabInfo, description, t }: SidebarGuideProps): ReactNode {
  const session = roleplaySessionOf(sessionId)
  const pack = usePack(session)?.pack ?? undefined
  const page = pack?.surfaces.sidebar
  const { tab } = useTabInfo()
  if (pack === undefined || page === undefined) return null
  const title = page.title === '' ? pack.name : page.title
  return (
    <div className={css.entry} data-sidebar-right-guide-entry={SIDEBAR_KIND}>
      <Button variant="ghost" className={css.main} aria-label={title} onClick={() => { tab.actions.openTab(SIDEBAR_KIND, { replaceTab: true }) }} />
      <span className={css.icon} aria-hidden="true"><IconGlobeOutlineRegular size={description === undefined ? 22 : 26} /></span>
      <span className={css.text}>
        <span className={css.title} aria-hidden="true">{title}</span>
        <span className={css.description} aria-hidden="true">{t('sidebarDescription')}</span>
      </span>
    </div>
  )
}

/**
 * The body of the tab: a bar of ours with a way back to the guide, and under it the pack's page, which has the rest of
 * the sidebar to itself. The page is kept while the tab is hidden, so what it draws goes on between looks.
 */
export function SidebarBody({ sessionId, useTabInfo, frameInput, t }: SidebarBodyProps): ReactNode {
  const session = roleplaySessionOf(sessionId)
  const { tab } = useTabInfo()
  const pack = usePack(session)?.pack ?? undefined
  const page = pack?.surfaces.sidebar
  const view = usePlayerView(session, tab.visible && page !== undefined)
  const back = (): void => { tab.actions.openTab('guide', { replaceTab: true }) }
  return (
    <div className={css.page} data-rp="sidebar">
      <div className={css.bar}>
        <Button variant="ghost" size="sm" onClick={back}>← {t('sidebarBack')}</Button>
        {pack !== undefined && <span className={css.name}>{page?.title === undefined || page.title === '' ? pack.name : page.title}</span>}
      </div>
      <div className={css.content}>
        {session === undefined || pack === undefined || page === undefined
          ? <p className={css.message}>{t('sidebarNone')}</p>
          : <PackFrame session={session} pack={pack} surface="sidebar" view={view} input={frameInput} fill title={page.title === '' ? pack.name : page.title} />}
      </div>
    </div>
  )
}
