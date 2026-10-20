import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresetStatus } from '../../shared/presets.ts'
import { applyPreset, loadPresetStatus } from '../presets-api.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/** The writing preset the story's prompts came from, whether it still matches the library, and a way to switch or take it out. */
export function PresetSection({ t, session, disabled }: { t: Translate; session: string; disabled: boolean }) {
  const [status, setStatus] = useState<PresetStatus>()
  const [choice, setChoice] = useState('')
  const [failure, setFailure] = useState<string>()
  const [report, setReport] = useState<string>()
  const [sure, setSure] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    loadPresetStatus(session, abort.signal).then(
      (next) => { setStatus(next); setFailure(undefined) },
      (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) },
    )
    return () => { abort.abort() }
  }, [session, version])

  const run = (name: string | undefined): void => {
    setSure(false)
    applyPreset(session, name, new AbortController().signal).then(
      (done) => { setReport(t('presetApplied', { count: done.files.length })); setFailure(undefined); setChoice(''); setVersion(number => number + 1) },
      (error: unknown) => { setReport(undefined); setFailure(t('presetFailed', { message: message(error) })) },
    )
  }

  if (status === undefined) return failure === undefined ? null : <p className={css.error} role="alert">{t('presetLoadFailed', { message: failure })}</p>
  if (status.applied === undefined && status.available.length === 0) return null
  const applied = status.applied
  const library = applied === undefined ? undefined : status.available.find(entry => entry.name === applied.name)
  return (
    <section className={css.activity} data-testid="roleplay-preset">
      <strong>{t('presetTitle')}</strong>
      <p className={css.description}>{t('presetHelp')}</p>
      <p className={css.description}>{applied === undefined ? t('presetNone') : t(`presetState_${applied.state}`, { name: library?.title ?? applied.name })}</p>
      <label className={css.field} style={{ maxWidth: 'none' }}>
        <span className={css.label}>{t('presetChoose')}</span>
        <select className={css.select} value={choice} disabled={disabled} onChange={(event) => { setChoice(event.target.value); setSure(false) }}>
          <option value="">{t('presetKeep')}</option>
          {applied !== undefined && <option value="__none">{t('presetRemove')}</option>}
          {status.available.map(entry => <option key={entry.name} value={entry.name} disabled={entry.problems.length > 0}>{entry.problems.length > 0 ? t('presetBroken', { name: entry.title }) : entry.title}</option>)}
        </select>
      </label>
      {(choice !== '' || (applied !== undefined && applied.state === 'changed')) && (
        <div>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { if (sure) run(choice === '' ? applied?.name : choice === '__none' ? undefined : choice); else setSure(true) }}>
            {sure ? t('presetConfirm') : choice === '__none' ? t('presetTakeOut') : choice === '' ? t('presetReapply') : t('presetSwitch')}
          </Button>
          {sure && <button type="button" className={css.link} onClick={() => { setSure(false) }}>{t('vectorsCancel')}</button>}
        </div>
      )}
      {report !== undefined && <p className={css.description} role="status">{report}</p>}
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </section>
  )
}
