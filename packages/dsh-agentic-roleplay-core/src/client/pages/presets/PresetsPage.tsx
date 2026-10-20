import { useEffect, useId, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresetSummary } from '../../../shared/presets.ts'
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
const nameFromFile = (file: string): string => file.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64)

function NameDialog({ t, mode, file, submit, onClose }: { t: PresetsPageProps['t']; mode: 'create' | 'import'; file?: string; submit: (name: string, title: string, description: string) => Promise<void>; onClose: () => void }) {
  const formId = useId()
  const [name, setName] = useState(file === undefined ? '' : nameFromFile(file))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const go = (): void => {
    if (!NAME.test(name) || busy) return
    setBusy(true); setError(undefined)
    submit(name, title.trim(), description.trim()).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  const importing = mode === 'import'
  return (
    <Modal open onClose={onClose} title={importing ? t('importTitle') : t('createTitle')} description={importing ? t('importHelp', { file: file ?? '' }) : t('createHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || !NAME.test(name)}>{importing ? (busy ? t('importing') : t('import')) : (busy ? t('creating') : t('create'))}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); go() }}>
        <label className={css.field}><span className={css.label}>{t('presetName')}</span><Input value={name} maxLength={64} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} /><span className={css.help}>{t('presetNameHelp')}</span></label>
        {!importing && <label className={css.field}><span className={css.label}>{t('presetTitle')}</span><Input value={title} maxLength={300} onChange={(event) => { setTitle(event.target.value) }} /></label>}
        {!importing && <label className={css.field}><span className={css.label}>{t('presetDescription')}</span><Input value={description} maxLength={300} onChange={(event) => { setDescription(event.target.value) }} /></label>}
        {error !== undefined && <p className={css.error} role="alert">{importing ? t('importFailed', { message: error }) : t('createFailed', { message: error })}</p>}
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
export function PresetsPage({ t, usePresets, load, refresh, create, remove, author, importFile }: PresetsPageProps) {
  const state = usePresets(snapshot => snapshot)
  const [editing, setEditing] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PresetSummary>()
  const [uploaded, setUploaded] = useState<File>()
  const [notice, setNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [load])

  const open = (name: string): void => {
    setNotice(undefined)
    author(name).catch((failure: unknown) => { setNotice(t('authorFailed', { message: messageOf(failure) })) })
  }

  if (editing !== undefined) return <PresetEditor t={t} name={editing} onBack={() => { setEditing(undefined); refresh() }} author={() => { open(editing) }} />

  const presets = state.presets ?? []
  const failedWithoutData = state.status === 'failed' && state.presets === undefined
  return (
    <div className={css.page} data-testid="roleplay-presets-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.presets === undefined ? '' : t(presets.length === 1 ? 'countOne' : 'countOther', { count: presets.length })}</span>
        <div className={css.actions}>
          <input ref={picker} type="file" accept=".json,application/json" hidden data-testid="roleplay-preset-file" onChange={(event) => { setUploaded(event.target.files?.[0]); event.target.value = '' }} />
          <Button variant="outline" size="sm" onClick={() => { picker.current?.click() }}>{t('import')}</Button>
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
      {creating && <NameDialog t={t} mode="create" submit={create} onClose={() => { setCreating(false) }} />}
      {uploaded !== undefined && <NameDialog t={t} mode="import" file={uploaded.name} submit={async (name) => { const file = uploaded; const result = await importFile(name, file); if (!result.started) setNotice(t('importNotStarted', { message: result.failure ?? '' })) }} onClose={() => { setUploaded(undefined) }} />}
      {deleting !== undefined && <DeleteDialog t={t} preset={deleting} remove={remove} onClose={() => { setDeleting(undefined) }} />}
    </div>
  )
}
