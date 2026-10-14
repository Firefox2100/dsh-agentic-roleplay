import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InterfaceStatus } from '../../shared/interface-pack.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import { loadInterfaceStatus, syncInterface } from './settings-api.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/**
 * The interface pack of the story: which one is in use or why none is, a choice of the packs the story could use (kept
 * with the other settings, so it is saved with them), and, when the world's packs are not what the story copied, a way
 * to bring them in.
 */
export function InterfaceSection({ t, session, value, onChange, saved, disabled }: {
  t: Translate
  session: string
  /** The choice as it stands in the form. */
  value: string
  onChange: (value: string) => void
  /** The choice as it was last saved: the status is read again when it changes. */
  saved: string
  disabled: boolean
}) {
  const [status, setStatus] = useState<InterfaceStatus | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [report, setReport] = useState<string | undefined>(undefined)
  const [sure, setSure] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    loadInterfaceStatus(session, abort.signal).then(
      (next) => { setStatus(next); setFailure(undefined) },
      (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) },
    )
    return () => { abort.abort() }
  }, [session, saved, version])

  const update = (): void => {
    setSure(false)
    syncInterface(session, new AbortController().signal).then(
      (done) => { setReport(t('packUpdated', { updated: done.updated.join(', ') || '-', added: done.added.join(', ') || '-' })); setFailure(undefined); setVersion(number => number + 1) },
      (error: unknown) => { setReport(undefined); setFailure(t('packSyncFailed', { message: message(error) })) },
    )
  }

  if (status === undefined) return failure === undefined ? null : <p className={css.error} role="alert">{t('packLoadFailed', { message: failure })}</p>
  const inUse = status.available.find(entry => entry.id === status.active)
  const changed = status.world?.packs.filter(entry => entry.state === 'different').map(entry => entry.id) ?? []
  const fresh = status.world?.packs.filter(entry => entry.state === 'new').map(entry => entry.id) ?? []
  const broken = status.world?.packs.filter(entry => entry.problems.length > 0).map(entry => entry.id) ?? []
  return (
    <section className={css.activity} data-testid="roleplay-interface-pack">
      <strong>{t('packTitle')}</strong>
      <p className={css.description}>{t('packHelp')}</p>
      <p className={css.description}>
        {status.setting === 'none' ? t('packOff') : inUse === undefined ? t('packNone') : t('packActive', { name: inUse.name })}
      </p>
      {inUse !== undefined && inUse.surfaces.length > 0 && <p className={css.help}>{t('packSurfaces', { surfaces: inUse.surfaces.join(', ') })}</p>}
      {status.problems.length > 0 && (
        <div role="alert">
          <p className={css.error}>{t('packProblems')}</p>
          <ul className={css.list}>{status.problems.map((problem, index) => <li key={index}>{problem.file === '' ? problem.message : `${problem.file}: ${problem.message}`}</li>)}</ul>
        </div>
      )}
      <label className={css.field} style={{ maxWidth: 'none' }}>
        <span className={css.label}>{t('packChoose')}</span>
        <select className={css.select} value={value} disabled={disabled} onChange={(event) => { onChange(event.target.value) }}>
          <option value="">{t('packFirst')}</option>
          <option value="none">{t('packPlain')}</option>
          {status.available.map((entry) => {
            // Two packs may carry the same name; the folder tells them apart.
            const name = status.available.filter(other => other.name === entry.name).length > 1 ? `${entry.name} — ${entry.id}` : entry.name
            return (
              <option key={entry.id} value={entry.id}>
                {entry.problems.length > 0 ? t('packBroken', { name }) : entry.from === 'root' ? t('packFromRoot', { name }) : name}
              </option>
            )
          })}
        </select>
      </label>
      {changed.length > 0 && <p className={css.description}>{t('packWorldChanged', { names: changed.join(', ') })}</p>}
      {fresh.length > 0 && <p className={css.description}>{t('packWorldNew', { names: fresh.join(', ') })}</p>}
      {broken.length > 0 && <p className={css.error}>{t('packWorldProblems', { names: broken.join(', ') })}</p>}
      {(changed.length > 0 || fresh.length > 0) && broken.length === 0 && (
        <div>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { if (sure) update(); else setSure(true) }}>{sure ? t('packUpdateConfirm') : t('packUpdate')}</Button>
          {sure && <button type="button" className={css.link} onClick={() => { setSure(false) }}>{t('vectorsCancel')}</button>}
        </div>
      )}
      {report !== undefined && <p className={css.description} role="status">{report}</p>}
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </section>
  )
}
