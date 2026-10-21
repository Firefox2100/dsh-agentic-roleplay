import { useEffect, useId, useRef, useState } from 'react'
import { trimCharacters, withoutExtension } from '../../../shared/text.ts'
import { Button, IconRefreshOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresetSummary } from '../../../shared/presets.ts'
import type { SelectionPreview } from '../../../shared/import-selection.ts'
import { ImportSelectionDialog } from '../../widgets/import-selection/ImportSelection.tsx'
import type {} from '../../panel/slot-contract.ts'
import { PresetEditor } from './PresetEditor.tsx'
import type { PresetsFace } from './presets-controller.ts'
import css from './PresetsPage.module.css'

export type PresetsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.presets'>
  & InjectFace<PresetsFace>

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
const nameFromFile = (file: string): string => trimCharacters(withoutExtension(file).replace(/[^A-Za-z0-9_-]+/g, '-'), '-_').slice(0, 64)

function NameDialog({ t, submit, onClose }: { t: PresetsPageProps['t']; submit: (name: string, title: string, description: string) => Promise<void>; onClose: () => void }) {
  const formId = useId()
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const go = (): void => {
    if (!NAME.test(name) || busy) return
    setBusy(true); setError(undefined)
    submit(name, title.trim(), description.trim()).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('createTitle')} description={t('createHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || !NAME.test(name)}>{busy ? t('creating') : t('create')}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); go() }}>
        <label className={css.field}><span className={css.label}>{t('presetName')}</span><Input value={name} maxLength={64} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} /><span className={css.help}>{t('presetNameHelp')}</span></label>
        <label className={css.field}><span className={css.label}>{t('presetTitle')}</span><Input value={title} maxLength={300} onChange={(event) => { setTitle(event.target.value) }} /></label>
        <label className={css.field}><span className={css.label}>{t('presetDescription')}</span><Input value={description} maxLength={300} onChange={(event) => { setDescription(event.target.value) }} /></label>
        {error !== undefined && <p className={css.error} role="alert">{t('createFailed', { message: error })}</p>}
      </form>
    </Modal>
  )
}

function DeleteDialog({ t, preset, remove, onClose }: { t: PresetsPageProps['t']; preset: PresetSummary; remove: PresetsFace['remove']; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const confirm = (): void => {
    setBusy(true); setError(undefined)
    remove(preset.name).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('deleteTitle')} description={t('deleteHelp', { name: preset.title })} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? t('deleting') : t('delete')}</Button></>}>
      {error !== undefined && <p className={css.error} role="alert">{t('deleteFailed', { message: error })}</p>}
    </Modal>
  )
}

/** The preset library: reusable writing instructions that a story copies when it starts. */
export function PresetsPage({ t, usePresets, load, refresh, create, remove, author, stage, importStaged, importVerbatim }: PresetsPageProps) {
  const state = usePresets(snapshot => snapshot)
  const [editing, setEditing] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PresetSummary>()
  const [staged, setStaged] = useState<SelectionPreview>()
  const [importName, setImportName] = useState('')
  const [staging, setStaging] = useState(false)
  const [notice, setNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [load])

  const open = (name: string): void => {
    setNotice(undefined)
    author(name).catch((failure: unknown) => { setNotice(t('authorFailed', { message: messageOf(failure) })) })
  }

  const choose = (file: File | undefined): void => {
    if (file === undefined) return
    setNotice(undefined)
    setStaging(true)
    stage(file).then(
      (preview) => { setStaging(false); setImportName(nameFromFile(preview.name === '' ? file.name : preview.name) || nameFromFile(file.name)); setStaged(preview) },
      (failure: unknown) => { setStaging(false); setNotice(t('importFailed', { message: messageOf(failure) })) },
    )
  }

  if (editing !== undefined) return <PresetEditor t={t} name={editing} onBack={() => { setEditing(undefined); refresh() }} author={() => { open(editing) }} />

  const presets = state.presets ?? []
  const failedWithoutData = state.status === 'failed' && state.presets === undefined
  return (
    <div className={css.page} data-testid="roleplay-presets-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.presets === undefined ? '' : t(presets.length === 1 ? 'countOne' : 'countOther', { count: presets.length })}</span>
        <div className={css.actions}>
          <input ref={picker} type="file" accept=".json,application/json" hidden data-testid="roleplay-preset-file" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = '' }} />
          <Button variant="outline" size="sm" disabled={staging} onClick={() => { picker.current?.click() }}>{staging ? t('importReading') : t('import')}</Button>
          <Button variant="primary" size="sm" onClick={() => { setCreating(true) }}>{t('create')}</Button>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={state.refreshing || state.status === 'loading'} aria-busy={state.refreshing} onClick={refresh}>{state.refreshing ? t('refreshing') : t('refresh')}</Button>
        </div>
      </div>
      {state.error !== undefined && !failedWithoutData && <p className={css.error} role="alert">{t('loadFailed', { message: state.error })}</p>}
      {notice !== undefined && <p className={css.error} role="alert">{notice}</p>}
      <div className={css.viewport}>
        {state.status === 'idle' || state.status === 'loading'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.error} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : presets.length === 0
              ? <p className={css.message}>{t('empty')}</p>
              : (
                <ul className={css.grid}>
                  {presets.map(preset => (
                    <li className={css.card} key={preset.name} data-testid="roleplay-preset-card">
                      <div className={css.head}><span className={css.title}>{preset.title}</span>{preset.title !== preset.name && <span className={css.name}>{preset.name}</span>}</div>
                      {preset.description !== '' && <p className={css.description}>{preset.description}</p>}
                      {preset.problems.length > 0
                        ? <p className={css.error}>{t('broken', { problems: preset.problems.join('; ') })}</p>
                        : <span className={css.meta}>{[t('languages', { list: preset.languages.join(', ') }), t('promptsCount', { count: preset.prompts.length })].join(' · ')}</span>}
                      {preset.rules.length > 0 && <p className={css.warning} role='note'>{t('rulesWarning', { list: preset.rules.join(', ') })}</p>}
                      <div className={css.cardActions}>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(preset.name) }}>{t('edit')}</Button>
                        <Button variant="outline" size="sm" onClick={() => { open(preset.name) }}>{t('author')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDeleting(preset) }}>{t('delete')}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
      </div>
      {creating && <NameDialog t={t} submit={create} onClose={() => { setCreating(false) }} />}
      {staged !== undefined && (
        <ImportSelectionDialog preview={staged} t={t} canConfirm={NAME.test(importName)} canVerbatim onClose={() => { setStaged(undefined) }} onConfirm={async (choice, options) => { if (options.verbatim) { await importVerbatim(choice, importName); setNotice(t('importedVerbatim', { name: importName })); return } const result = await importStaged(choice, importName); if (!result.started) setNotice(t('importNotStarted', { message: result.failure ?? '' })) }}>
          <label className={css.field}><span className={css.label}>{t('presetName')}</span><Input value={importName} maxLength={64} onChange={(event) => { setImportName(event.target.value) }} /><span className={css.help}>{t('presetNameHelp')}</span></label>
        </ImportSelectionDialog>
      )}
      {deleting !== undefined && <DeleteDialog t={t} preset={deleting} remove={remove} onClose={() => { setDeleting(undefined) }} />}
    </div>
  )
}
