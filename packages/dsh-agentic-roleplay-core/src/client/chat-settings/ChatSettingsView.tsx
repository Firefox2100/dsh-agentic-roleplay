import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import css from './ChatSettingsView.module.css'
import { NotRoleplayError, loadSettings, saveSettings } from './settings-api.ts'
import { fromDrafts, problemsOf, toDrafts, type Drafts } from '../settings-form/fields.ts'
import { useEmbeddingOptions } from '../settings-form/embedding-options.ts'
import { SettingsFields } from '../settings-form/SettingsFields.tsx'

export type ChatSettingsViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'roleplay.chatSettings'>

type Load =
  | { status: 'loading' }
  | { status: 'not-roleplay' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; payload: SettingsPayload }

/** The settings of one chat. Ordinary DSH chats have ids of the same shape, so the host decides whether this one is a roleplay session. */
export function ChatSettingsView({ t, sessionId }: ChatSettingsViewProps) {
  const session = roleplaySessionOf(sessionId)
  const [load, setLoad] = useState<Load>(session === undefined ? { status: 'not-roleplay' } : { status: 'loading' })
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const options = useEmbeddingOptions('all')

  useEffect(() => {
    if (session === undefined) return undefined
    const abort = new AbortController()
    setLoad({ status: 'loading' })
    loadSettings(session, abort.signal).then(
      (payload) => { setLoad({ status: 'ready', payload }); setDrafts(toDrafts(payload.settings, options)) },
      (failure: unknown) => {
        if (abort.signal.aborted) return
        setLoad(failure instanceof NotRoleplayError ? { status: 'not-roleplay' } : { status: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      },
    )
    return () => { abort.abort() }
  }, [session, options])

  if (load.status === 'loading') return <p className={css.message}>{t('loading')}</p>
  if (load.status === 'not-roleplay') return <p className={css.message}>{t('notRoleplay')}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('loadFailed', { message: load.message })}</p>

  const { payload } = load
  const bad = problemsOf(drafts, options)
  const changed = bad.size === 0 && JSON.stringify(fromDrafts(payload.settings, drafts, options)) !== JSON.stringify(payload.settings)

  const change = (key: string, value: string | boolean): void => {
    setDrafts({ ...drafts, [key]: value })
    setSaved(false)
  }

  const save = (): void => {
    if (session === undefined || !changed) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    saveSettings(session, fromDrafts(payload.settings, drafts, options), new AbortController().signal).then(
      (next) => { setLoad({ status: 'ready', payload: next }); setDrafts(toDrafts(next.settings, options)); setSaved(true) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setSaving(false) })
  }

  return (
    <form className={css.view} data-testid="roleplay-chat-settings" onSubmit={(event) => { event.preventDefault(); save() }}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      {payload.pendingRecords > 0 && <p className={css.notice} role="status">{t('pendingRecords', { count: payload.pendingRecords })}</p>}
      <SettingsFields t={t} drafts={drafts} onChange={change} options={options} disabled={saving} />
      {error !== undefined && <p className={css.error} role="alert">{t('saveFailed', { message: error })}</p>}
      <div className={css.actions}>
        <Button variant="primary" size="sm" type="submit" disabled={!changed || saving}>{saving ? t('saving') : t('save')}</Button>
        {saved && <span className={css.saved}>{t('saved')}</span>}
      </div>
    </form>
  )
}
