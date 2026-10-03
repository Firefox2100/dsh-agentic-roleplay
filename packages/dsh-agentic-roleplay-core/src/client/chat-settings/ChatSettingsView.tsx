import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import css from './ChatSettingsView.module.css'
import { NotRoleplayError, loadSettings, saveSettings } from './settings-api.ts'

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
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (session === undefined) return undefined
    const abort = new AbortController()
    setLoad({ status: 'loading' })
    loadSettings(session, abort.signal).then(
      (payload) => { setLoad({ status: 'ready', payload }); setDraft(String(payload.settings.maxRounds)) },
      (failure: unknown) => {
        if (abort.signal.aborted) return
        setLoad(failure instanceof NotRoleplayError ? { status: 'not-roleplay' } : { status: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      },
    )
    return () => { abort.abort() }
  }, [session])

  if (load.status === 'loading') return <p className={css.message}>{t('loading')}</p>
  if (load.status === 'not-roleplay') return <p className={css.message}>{t('notRoleplay')}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('loadFailed', { message: load.message })}</p>

  const { payload } = load
  const { minRounds, maxRounds } = payload.limits
  const value = Number(draft)
  const valid = draft.trim() !== '' && Number.isInteger(value) && value >= minRounds && value <= maxRounds
  const changed = valid && value !== payload.settings.maxRounds

  const save = (): void => {
    if (session === undefined || !changed) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    saveSettings(session, { maxRounds: value }, new AbortController().signal).then(
      (next) => { setLoad({ status: 'ready', payload: next }); setDraft(String(next.settings.maxRounds)); setSaved(true) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setSaving(false) })
  }

  return (
    <form className={css.view} data-testid="roleplay-chat-settings" onSubmit={(event) => { event.preventDefault(); save() }}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      <label className={css.field}>
        <span className={css.label}>{t('maxRounds')}</span>
        <Input
          type="number"
          min={minRounds}
          max={maxRounds}
          step={1}
          value={draft}
          aria-invalid={!valid}
          onChange={(event) => { setDraft(event.target.value); setSaved(false) }}
        />
      </label>
      <p className={css.help}>{t('maxRoundsHelp')}</p>
      {!valid && <p className={css.error}>{t('invalid', { min: minRounds, max: maxRounds })}</p>}
      {error !== undefined && <p className={css.error} role="alert">{t('saveFailed', { message: error })}</p>}
      <div className={css.actions}>
        <Button variant="primary" size="sm" type="submit" disabled={!changed || saving}>{saving ? t('saving') : t('save')}</Button>
        {saved && <span className={css.saved}>{t('saved')}</span>}
      </div>
    </form>
  )
}
