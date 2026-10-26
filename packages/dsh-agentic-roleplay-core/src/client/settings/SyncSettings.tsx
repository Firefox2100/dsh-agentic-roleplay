import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { SYNC_PASSWORD_REF } from '../../shared/sync.ts'
import { describePassword, storePassword, type PasswordStatus } from '../sync-api.ts'
import type { SettingsLocaleKey } from './locales.ts'
import { syncDraftOf, syncProblem } from './sync.ts'
import css from './CatalogueSettings.module.css'

type Translate = (key: SettingsLocaleKey) => string

const PROBLEM_TEXT = { remote: 'syncProblemRemote', config: 'syncProblemConfig', keyName: 'catalogueProblemKeyName', interval: 'syncProblemInterval' } as const
const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/** The password of an encrypted rclone configuration: kept in the credential store, written here and never read back. */
function SyncPassword({ t, reference, disabled }: { t: Translate; reference: string; disabled: boolean }) {
  const [status, setStatus] = useState<PasswordStatus>()
  const [value, setValue] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      describePassword(reference, abort.signal).then((next) => { setStatus(next); setFailure(undefined) }, (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) })
    }, 400)
    return () => { clearTimeout(timer); abort.abort() }
  }, [reference])
  const keep = (next: string): void => {
    setBusy(true)
    storePassword(reference, next, new AbortController().signal).then((done) => { setStatus(done); setValue(''); setFailure(undefined) }, (error: unknown) => { setFailure(message(error)) }).finally(() => { setBusy(false) })
  }
  const blocked = disabled || busy || status?.writable === false
  const shown = status === undefined ? t('catalogueKeyChecking') : status.configured ? `${t('catalogueKeySet')} (${status.source ?? '?'})` : t('catalogueKeyUnset')
  return (
    <div className={css.keyArea} data-testid="roleplay-sync-password">
      <label className={css.field}><span className={css.label}>{t('syncPassword')}</span><Input type="password" autoComplete="off" value={value} disabled={blocked} placeholder={status?.configured === true ? '••••••••' : ''} onChange={(event) => { setValue(event.target.value) }} /></label>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={blocked || value === ''} onClick={() => { keep(value) }}>{t('catalogueKeyStore')}</Button>
        <Button variant="ghost" size="sm" disabled={blocked || status?.configured !== true} onClick={() => { keep('') }}>{t('catalogueKeyClear')}</Button>
      </div>
      <p className={css.keyHint} role="status">{reference} · {shown}{status?.writable === false ? ` · ${t('catalogueKeyReadOnly')}` : ''}</p>
      {failure !== undefined && <p className={css.problem} role="alert">{failure}</p>}
    </div>
  )
}

/** Where the content goes and how rclone is reached: the remote, the rclone program and its configuration file (outside the data folder), and how often to sync. */
export function SyncSettings({ t, text, disabled, onEdit }: { t: Translate; text: string; disabled: boolean; onEdit: (text: string) => void }) {
  const { config, intervalText } = syncDraftOf(text)
  const set = (patch: Partial<Omit<typeof config, 'intervalMinutes'>> & { intervalMinutes?: number | string }): void => { onEdit(JSON.stringify({ ...config, intervalMinutes: intervalText, ...patch })) }
  const problem = syncProblem(config, intervalText)
  return (
    <section className={css.section} data-testid="roleplay-sync-settings">
      <h3 className={css.title}>{t('sync')}</h3>
      <p className={css.hint}>{t('syncHint')}</p>
      <div className={css.row}>
        <label className={css.field}><span className={css.label}>{t('syncRemote')}</span><Input value={config.remote} disabled={disabled} placeholder="mydrive:dsh-roleplay" onChange={(event) => { set({ remote: event.target.value }) }} /></label>
        <label className={css.field}><span className={css.label}>{t('syncConfigFile')}</span><Input value={config.configFile} disabled={disabled} placeholder="~/.config/rclone/rclone.conf" onChange={(event) => { set({ configFile: event.target.value }) }} /></label>
        <label className={css.field}><span className={css.label}>{t('syncRclone')}</span><Input value={config.rclone} disabled={disabled} placeholder="rclone" onChange={(event) => { set({ rclone: event.target.value }) }} /></label>
        <label className={css.field}><span className={css.label}>{t('syncInterval')}</span><Input value={intervalText} disabled={disabled} inputMode="numeric" aria-invalid={problem === 'interval'} onChange={(event) => { set({ intervalMinutes: event.target.value }) }} /></label>
        <label className={css.field}><span className={css.label}>{t('catalogueKeyName')}</span><Input value={config.passwordRef} disabled={disabled} placeholder={SYNC_PASSWORD_REF} onChange={(event) => { set({ passwordRef: event.target.value }) }} /></label>
        <p className={css.keyHint}>{t('syncDetails')}</p>
        {problem !== undefined && <p className={css.problem} role="alert">{t(PROBLEM_TEXT[problem])}</p>}
      </div>
      <SyncPassword t={t} reference={config.passwordRef.trim() || SYNC_PASSWORD_REF} disabled={disabled} />
    </section>
  )
}
