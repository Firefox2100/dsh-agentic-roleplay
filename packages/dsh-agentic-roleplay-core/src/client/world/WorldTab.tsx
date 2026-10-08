import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { WorldEditor } from '../world-editor/WorldEditor.tsx'
import { worldSource } from '../world-editor/authored-world-source.ts'
import { sessionSource } from './session-source.ts'

export type WorldTabProps = PropsRuntime<'conversation.view'> & PropsLocale<'roleplay.world'>

/** The story of the current chat, to read and to author. Ordinary DSH chats have ids of the same shape, so the host decides whether this one is a roleplay session. */
export function WorldTab({ t, sessionId }: WorldTabProps) {
  const session = roleplaySessionOf(sessionId)
  const world = authoredWorldOf(sessionId)
  const source = useMemo(() => session !== undefined ? sessionSource(session) : world !== undefined ? worldSource(world) : undefined, [session, world])
  if (source === undefined) return <p style={{ padding: 24, fontSize: 13 }}>{t('notRoleplay')}</p>
  return <WorldEditor t={t} source={source} notEditable={t('notRoleplay')} />
}
