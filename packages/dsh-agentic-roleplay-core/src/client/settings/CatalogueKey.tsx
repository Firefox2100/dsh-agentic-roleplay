import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogueKeyStatus } from '../../shared/catalogue.ts'
import { describeKey, storeKey } from './catalogue-keys-api.ts'
import { keyRefOf, type CatalogueRow } from './catalogues.ts'
import type { SettingsLocaleKey } from './locales.ts'
import css from './CatalogueSettings.module.css'

type Translate = (key: SettingsLocaleKey) => string

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/**
 * The key of one catalogue: a name in the credential store and a write-only box. The key is kept by the store the profile uses
 * (a file by default, anything another plugin provides) and never comes back to the page, only whether it is set and where from.
 */
export function CatalogueKey({ t, row, disabled, onChange }: { t: Translate; row: CatalogueRow; disabled: boolean; onChange: (patch: Partial<CatalogueRow>) => void }) {
  const ref = keyRefOf(row)
  const [status, setStatus] = useState<CatalogueKeyStatus>()
  const [value, setValue] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setStatus(undefined)
    if (ref === undefined) return undefined
    const abort = new AbortController()
    const timer = setTimeout(() => {
      describeKey(ref, abort.signal).then(
        (next) => { setStatus(next); setFailure(undefined) },
        (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) },
      )
    }, 400)
    return () => { clearTimeout(timer); abort.abort() }
  }, [ref])

  const keep = (next: string, then?: () => void): void => {
    if (ref === undefined) return
    setBusy(true)
    storeKey(ref, next, new AbortController().signal).then(
      (done) => { setStatus(done); setValue(''); setFailure(undefined); then?.() },
      (error: unknown) => { setFailure(message(error)) },
    ).finally(() => { setBusy(false) })
  }

  const legacy = row.apiKey.trim()
  const shown = status === undefined ? t('catalogueKeyChecking') : status.configured ? `${t('catalogueKeySet')} (${status.source ?? '?'})` : t('catalogueKeyUnset')
  return (
    <div className={css.keyArea} data-testid="roleplay-catalogue-key">
      <label className={css.field}><span className={css.label}>{t('catalogueKeyName')}</span><Input value={row.apiKeyRef} disabled={disabled} placeholder={ref ?? ''} onChange={(event) => { onChange({ apiKeyRef: event.target.value }) }} /></label>
      <label className={css.field}><span className={css.label}>{t('catalogueKey')}</span><Input type="password" autoComplete="off" value={value} disabled={disabled || busy || ref === undefined || status?.writable === false} placeholder={status?.configured === true ? '••••••••' : ''} onChange={(event) => { setValue(event.target.value) }} /></label>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={disabled || busy || value === '' || ref === undefined || status?.writable === false} onClick={() => { keep(value) }}>{t('catalogueKeyStore')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || busy || status?.configured !== true || status.writable === false} onClick={() => { keep('') }}>{t('catalogueKeyClear')}</Button>
      </div>
      <p className={css.keyHint} role="status">{ref ?? ''} · {shown}{status?.writable === false ? ` · ${t('catalogueKeyReadOnly')}` : ''}</p>
      {legacy !== '' && (
        <p className={css.problem} role="note">
          {t('catalogueKeyLegacy')}{' '}
          <Button variant="outline" size="sm" disabled={disabled || busy || ref === undefined || status?.writable === false} onClick={() => { keep(legacy, () => { onChange({ apiKey: '', apiKeyRef: ref ?? '' }) }) }}>{t('catalogueKeyMove')}</Button>
        </p>
      )}
      {failure !== undefined && <p className={css.problem} role="alert">{failure}</p>}
    </div>
  )
}
