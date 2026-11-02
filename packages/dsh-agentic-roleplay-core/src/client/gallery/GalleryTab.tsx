import { useMemo, type ReactNode } from 'react'
import { Button, IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { GalleryView } from '../widgets/gallery-view/GalleryView.tsx'
import { SidebarGuideEntry } from '../widgets/sidebar-guide/SidebarGuideEntry.tsx'
import css from './GalleryTab.module.css'

/** The kind of the tab type, and the identity it registers its card and body under. */
export const GALLERY_KIND = 'roleplay-gallery'
export const GALLERY_ID = '@dsh-agentic-roleplay/core/gallery-sidebar'

export type GalleryBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'roleplay.gallery'> & InjectFace<Record<string, never>> & { sessionId: string }
export type GalleryGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'roleplay.gallery'> & { sessionId: string }

/** The guide entry that opens the gallery; only a roleplay chat has it. */
export function GalleryGuide({ sessionId, useTabInfo, t }: GalleryGuideProps): ReactNode {
  const { tab } = useTabInfo()
  if (roleplaySessionOf(sessionId) === undefined) return null
  return <SidebarGuideEntry kind={GALLERY_KIND} title={t('tab')} description={t('guideText')} icon={IconBrowseOutlineRegular} onOpen={() => { tab.actions.openTab(GALLERY_KIND, { replaceTab: true }) }} />
}

/** The gallery page of the right sidebar: the pictures of the chat's roleplay session, readable beside the story. */
export function GalleryBody({ sessionId, useTabInfo, t }: GalleryBodyProps): ReactNode {
  const session = roleplaySessionOf(sessionId)
  const { tab } = useTabInfo()
  const target = useMemo(() => (session === undefined ? undefined : { kind: 'sessions' as const, id: session }), [session])
  return (
    <div className={css.page}>
      <div className={css.bar}>
        <Button variant="ghost" size="sm" onClick={() => { tab.actions.openTab('guide', { replaceTab: true }) }}>← {t('back')}</Button>
      </div>
      {target === undefined ? <p className={css.message}>{t('notRoleplay')}</p> : <GalleryView t={t} target={target} />}
    </div>
  )
}
