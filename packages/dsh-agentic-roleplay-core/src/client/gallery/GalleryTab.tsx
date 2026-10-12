import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { GalleryView } from '../widgets/gallery-view/GalleryView.tsx'
import css from '../widgets/gallery-view/GalleryView.module.css'

export type GalleryTabProps = PropsRuntime<'conversation.view'> & PropsLocale<'roleplay.gallery'>

/** The Gallery tab of a chat: the pictures of its roleplay session. */
export function GalleryTab({ t, sessionId }: GalleryTabProps) {
  const session = roleplaySessionOf(sessionId)
  const target = useMemo(() => (session === undefined ? undefined : { kind: 'sessions' as const, id: session }), [session])
  if (target === undefined) return <p className={css.message}>{t('notRoleplay')}</p>
  return <GalleryView t={t} target={target} />
}
