import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SelectionChoice, SelectionPreview } from '../../../shared/import-selection.ts'
import { SAMPLING_KEYS } from '../../../shared/sampling.ts'
import type { ImportSelectionKey } from './locales.ts'
import css from './ImportSelection.module.css'

/** How the person wants the import done beyond what is ticked. */
export interface ImportOptions {
  /** Without the assistant: the items are kept as they are (lorebooks, and presets that go into the library). */
  verbatim: boolean
  /** Who the entries of a verbatim import are told to. */
  knownBy: 'everyone' | 'master'
}

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/**
 * The choice of what an imported preset or lorebook brings: every item the file offers, each ticked or not, and the file's sampling. Only the ticked items reach the conversion.
 * What the caller needs besides the choice (a name for the new library entry) goes in as `children`.
 */
export function ImportSelectionDialog({ preview, t, onConfirm, onClose, canConfirm = true, canVerbatim = preview.kind === 'lorebook', children }: {
  preview: SelectionPreview
  t: (key: ImportSelectionKey, values?: Record<string, string>) => string
  /** Rejects with the reason when the import cannot go ahead; the dialog then stays open and says why. */
  onConfirm: (choice: SelectionChoice, options: ImportOptions) => Promise<void>
  onClose: () => void
  canConfirm?: boolean
  /** Whether the caller can import without the assistant: always for a lorebook, and for a preset only when it goes into the library. */
  canVerbatim?: boolean
  children?: ReactNode
}) {
  const asFile = (): Set<string> => new Set(preview.items.filter(item => item.enabled).map(item => item.id))
  const [ticked, setTicked] = useState(asFile)
  const [keepSampling, setKeepSampling] = useState(true)
  const [verbatim, setVerbatim] = useState(false)
  const [knownBy, setKnownBy] = useState<ImportOptions['knownBy']>('master')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const usable = preview.items.filter(item => item.usable)
  const sampling = preview.sampling === undefined ? [] : SAMPLING_KEYS.flatMap(key => (preview.sampling?.[key] === undefined ? [] : [[key, preview.sampling[key]] as const]))
  const toggle = (id: string, on: boolean): void => { const next = new Set(ticked); if (on) next.add(id); else next.delete(id); setTicked(next) }
  const confirm = (): void => {
    setBusy(true); setFailure(undefined)
    onConfirm({ id: preview.id, enabled: preview.items.filter(item => item.usable && ticked.has(item.id)).map(item => item.id), sampling: keepSampling }, { verbatim: verbatim && canVerbatim, knownBy }).then(onClose, (problem: unknown) => { setBusy(false); setFailure(messageOf(problem)) })
  }
  const ignored = [['regexScripts', preview.ignored?.regexScripts], ['scripts', preview.ignored?.scripts]].flatMap(([key, count]) => (typeof count === 'number' && count > 0 ? [t(`is_ignored_${key as 'regexScripts' | 'scripts'}`, { count: String(count) })] : []))
  const on = usable.filter(item => ticked.has(item.id)).length
  return (
    <Modal open onClose={onClose} title={t(`is_title_${preview.kind}`, { name: preview.name })} description={t(`is_help_${preview.kind}`)} closeLabel={t('is_close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('is_cancel')}</Button><Button variant="primary" disabled={busy || on === 0 || !canConfirm} onClick={confirm}>{busy ? t('is_importing') : t('is_import')}</Button></>}>
      <div className={css.body} data-testid="roleplay-import-selection">
        {children !== undefined && <div className={css.extra}>{children}</div>}
        {ignored.length > 0 && <p className={css.help} data-testid="roleplay-import-ignored">{t('is_ignored', { parts: ignored.join(', ') })}</p>}
        <div className={css.bar}>
          <span className={css.count} data-testid="roleplay-import-count">{t('is_selected', { on: String(on), total: String(usable.length) })}</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setTicked(new Set(usable.map(item => item.id))) }}>{t('is_all')}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setTicked(new Set()) }}>{t('is_none')}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setTicked(asFile()) }}>{t('is_asFile')}</Button>
        </div>
        <ul className={css.list}>
          {preview.items.map(item => (
            <li className={css.row} key={item.id} data-usable={item.usable} data-item={item.id}>
              <input type="checkbox" checked={item.usable && ticked.has(item.id)} disabled={busy || !item.usable} aria-label={item.title} onChange={(event) => { toggle(item.id, event.target.checked) }} />
              <span className={css.text}>
                <span>{item.title}</span>
                <span className={css.meta}>{[item.detail, t('is_chars', { count: String(item.chars) })].filter(part => part !== '').join(' · ')}</span>
                {item.note !== undefined && <span className={css.note}>{t(`is_note_${item.note}`)}</span>}
                <details>
                  <summary className={css.meta}>{t('is_show')}</summary>
                  <pre className={css.full}>{item.text}</pre>
                </details>
              </span>
            </li>
          ))}
        </ul>
        {preview.kind === 'preset' && (
          <div className={css.sampling}>
            {sampling.length === 0
              ? <span className={css.meta}>{t('is_samplingNone')}</span>
              : (
                <>
                  <label><input type="checkbox" checked={keepSampling} disabled={busy} data-testid="roleplay-import-sampling" onChange={(event) => { setKeepSampling(event.target.checked) }} /> {t('is_sampling')}</label>
                  <span className={css.meta}>{sampling.map(([key, value]) => `${t(`is_sampling_${key}` as ImportSelectionKey)}: ${value}`).join(' · ')}</span>
                  <span className={css.meta}>{t('is_samplingHelp')}</span>
                </>
              )}
          </div>
        )}
        {canVerbatim && (
          <div className={css.sampling}>
            <label><input type="checkbox" checked={verbatim} disabled={busy} data-testid="roleplay-import-verbatim" onChange={(event) => { setVerbatim(event.target.checked) }} /> {t(preview.kind === 'lorebook' ? 'is_verbatim' : 'is_verbatimPreset')}</label>
            <span className={css.meta}>{t(preview.kind === 'lorebook' ? 'is_verbatimHelp' : 'is_verbatimPresetHelp')}</span>
            {verbatim && preview.kind === 'lorebook' && (
              <label className={css.meta}>{t('is_knownBy')}: <select value={knownBy} disabled={busy} data-testid="roleplay-import-known-by" onChange={(event) => { setKnownBy(event.target.value === 'everyone' ? 'everyone' : 'master') }}><option value="master">{t('is_knownBy_master')}</option><option value="everyone">{t('is_knownBy_everyone')}</option></select></label>
            )}
          </div>
        )}
        {failure !== undefined && <p className={css.error} role="alert">{t('is_failed', { message: failure })}</p>}
      </div>
    </Modal>
  )
}
