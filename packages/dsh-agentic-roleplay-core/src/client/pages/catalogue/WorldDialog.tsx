import { useEffect, useState } from 'react'
import { Button, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImportPreview } from '../../../shared/import-card.ts'
import type { CatalogueKind, CatalogueSourceStatus, CatalogueWorldDetail, InstallMode } from '../../../shared/catalogue.ts'
import { importStagedLorebook, importStagedPreset, importVerbatimLorebook, importVerbatimPreset, stageRelease } from '../../import-selection-api.ts'
import { ImportSelectionDialog, type ImportOptions } from '../../widgets/import-selection/ImportSelection.tsx'
import type { SelectionChoice, SelectionPreview } from '../../../shared/import-selection.ts'
import { downloadUrl, install, InstallConflict, loadWorld, stageCard } from './catalogue-api.ts'
import type { CatalogueLocaleKey } from './locales.ts'
import css from './CataloguePage.module.css'

type Translate = (key: CatalogueLocaleKey, values?: Record<string, string | number>) => string

const sizeOf = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const dateOf = (iso: string): string => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString() }
const messageOf = (problem: unknown): string => (problem instanceof Error ? problem.message : String(problem))

interface Done { text: string; packs: string[]; backup?: string; untracked: boolean }

/** A card the person is to look through before it becomes a world. */
export interface CardReview { preview: ImportPreview; source: string; versionId: string }

export interface WorldDialogProps {
  t: Translate
  source: CatalogueSourceStatus
  id: string
  name: string
  kind: CatalogueKind
  onClose: () => void
  /** A world was installed, updated or made: what depends on the person's worlds is read again. */
  onChanged: () => void
  openChat: (chatSessionId: string) => void
  /** A card was downloaded and read: the page shows it for the person to choose what becomes of it. */
  onReview: (review: CardReview) => void
}

/** One entry of a catalogue: what it says about itself, its releases, and installing, updating or converting one of them. */
export function WorldDialog({ t, source, id, name, kind, onClose, onChanged, openChat, onReview }: WorldDialogProps) {
  const [detail, setDetail] = useState<CatalogueWorldDetail>()
  const [error, setError] = useState<string>()
  const [versionId, setVersionId] = useState('')
  const [busy, setBusy] = useState<InstallMode | 'convert' | 'preset' | 'lorebook'>()
  const [done, setDone] = useState<Done>()
  const [failure, setFailure] = useState<string>()
  const [conflict, setConflict] = useState<InstallConflict>()
  const [selecting, setSelecting] = useState<SelectionPreview>()

  useEffect(() => {
    const abort = new AbortController()
    loadWorld(source.name, id, abort.signal).then(
      (loaded) => { setDetail(loaded); setVersionId(loaded.versions[0]?.id ?? '') },
      (problem: unknown) => { if (!abort.signal.aborted) setError(messageOf(problem)) },
    )
    return () => { abort.abort() }
  }, [source.name, id])

  const version = detail?.versions.find(candidate => candidate.id === versionId)
  const installed = detail?.installed
  const installedIndex = installed?.versionId === undefined ? -1 : detail?.versions.findIndex(entry => entry.id === installed.versionId) ?? -1
  const selectedIndex = detail?.versions.findIndex(entry => entry.id === versionId) ?? -1
  const isInstalledRelease = installed?.versionId !== undefined && installed.versionId === versionId
  const newer = installed !== undefined && !isInstalledRelease && (installedIndex === -1 || selectedIndex < installedIndex)

  const run = (mode: InstallMode, overwriteChanges = false): void => {
    if (version === undefined) return
    setBusy(mode); setFailure(undefined); setConflict(undefined)
    install({ url: downloadUrl(source.baseUrl, version.id), ...(version.sha256 === undefined ? {} : { sha256: version.sha256 }), mode, ...(overwriteChanges ? { overwriteChanges } : {}) }).then(
      (result) => {
        setBusy(undefined)
        setDone({ text: mode === 'update' ? t('updated', { name: result.world.name, version: version.version }) : t('installed', { name: result.world.name }), packs: result.packs, untracked: !result.tracked && mode !== 'copy', ...(result.backup === undefined ? {} : { backup: result.backup }) })
        onChanged()
      },
      (problem: unknown) => {
        setBusy(undefined)
        if (problem instanceof InstallConflict && problem.reason !== 'exists') setConflict(problem)
        else setFailure(t('installFailed', { message: messageOf(problem) }))
      },
    )
  }

  const runConvert = (): void => {
    if (version === undefined) return
    setBusy('convert'); setFailure(undefined)
    stageCard(source.name, version.id).then(
      (preview) => { setBusy(undefined); onReview({ preview, source: source.name, versionId: version.id }) },
      (problem: unknown) => { setBusy(undefined); setFailure(t('convertFailed', { message: messageOf(problem) })) },
    )
  }

  const stage = (kind: 'preset' | 'lorebook'): void => {
    if (version === undefined) return
    setBusy(kind); setFailure(undefined)
    stageRelease(kind, source.name, version.id).then(
      (preview) => { setBusy(undefined); setSelecting(preview) },
      (problem: unknown) => { setBusy(undefined); setFailure(t(kind === 'preset' ? 'importPresetFailed' : 'importLorebookFailed', { message: messageOf(problem) })) },
    )
  }
  const runPreset = (): void => { stage('preset') }
  const runLorebook = (): void => { stage('lorebook') }
  const importChosen = async (choice: SelectionChoice, options: ImportOptions): Promise<void> => {
    if (options.verbatim && selecting?.kind === 'lorebook') {
      const made = await importVerbatimLorebook(choice, { title: detail?.name ?? name, knownBy: options.knownBy })
      setDone({ text: t('importedVerbatim', { count: String(made.entries), name: made.name }), packs: [], untracked: false })
      return
    }
    if (options.verbatim && selecting?.kind === 'preset') {
      const made = await importVerbatimPreset(choice, { title: detail?.name ?? name })
      setDone({ text: t('importedVerbatimPreset', { name: made.name }), packs: [], untracked: false })
      return
    }
    const opened = await (selecting?.kind === 'lorebook' ? importStagedLorebook : importStagedPreset)(choice, { title: detail?.name ?? name, language: t('language') })
    openChat(opened.chatSessionId)
    onClose()
  }

  const idle = busy === undefined && done === undefined && conflict === undefined
  const primary = kind === 'lorebook'
    ? <Button variant="primary" disabled={!idle || version === undefined} onClick={runLorebook}>{busy === 'lorebook' ? t('importingLorebook') : t('importLorebookAction')}</Button>
    : kind === 'preset'
    ? <Button variant="primary" disabled={!idle || version === undefined} onClick={runPreset}>{busy === 'preset' ? t('importingPreset') : t('importPresetAction')}</Button>
    : kind === 'card'
    ? <Button variant="primary" disabled={!idle || version === undefined} onClick={runConvert}>{busy === 'convert' ? t('converting') : t('convert')}</Button>
    : installed === undefined
      ? <Button variant="primary" disabled={!idle || version === undefined} onClick={() => { run('new') }}>{busy === 'new' ? t('installing') : t('install')}</Button>
      : newer
        ? <Button variant="primary" disabled={!idle || version === undefined} onClick={() => { run('update') }}>{busy === 'update' ? t('updating') : t('update')}</Button>
        : undefined
  const copy = kind === 'world' && installed !== undefined && version !== undefined
    ? <Button variant="outline" disabled={!idle} onClick={() => { run('copy') }}>{busy === 'copy' ? t('installing') : t('installCopy')}</Button>
    : undefined

  return (
    <>
    <Modal open onClose={onClose} title={detail?.name ?? name} closeLabel={t('close')} footer={<>{copy}<Button variant="ghost" disabled={busy !== undefined} onClick={onClose}>{t('close')}</Button>{primary}</>}>
      <div className={css.detail} data-testid="roleplay-catalogue-detail">
        {error !== undefined && <p className={css.notice} role="alert">{t('detailFailed', { message: error })}</p>}
        {detail !== undefined && (
          <>
            <span className={css.meta}>{[detail.author === '' ? '' : t('by', { author: detail.author }), detail.language].filter(text => text !== '').join(' · ')}</span>
            {detail.tags.length > 0 && <div className={css.tags}>{detail.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}</div>}
            {detail.description !== '' && <p className={css.description}>{detail.description}</p>}
            {detail.versions.length === 0
              ? <p className={css.notice}>{t('noRelease')}</p>
              : (
                <label className={css.field}>
                  <span className={css.label}>{t('version')}</span>
                  <select className={css.select} value={versionId} disabled={busy !== undefined || done !== undefined} onChange={(event) => { setVersionId(event.target.value) }}>
                    {detail.versions.map(entry => <option key={entry.id} value={entry.id}>{t('released', { version: entry.version, date: dateOf(entry.publishedAt) })}{entry.byteSize === undefined ? '' : ` · ${sizeOf(entry.byteSize)}`}</option>)}
                  </select>
                </label>
              )}
            {kind === 'card' && <p className={css.success}>{t('convertNote')}</p>}
            {kind === 'preset' && <p className={css.success}>{t('importPresetNote')}</p>}
            {kind === 'lorebook' && <p className={css.success}>{t('importLorebookNote')}</p>}
            {kind === 'card' && detail.converted !== undefined && detail.converted.length > 0 && <p className={css.success}>{t('convertedBefore', { names: detail.converted.map(world => world.name).join(', ') })}</p>}
            {installed !== undefined && (
              <p className={css.success}>
                {installed.versionId === undefined ? t('installedUnknown') : t('installedFrom', { version: detail.versions.find(entry => entry.id === installed.versionId)?.version ?? installed.version ?? '' })}
                {installed.modified === true ? ` ${t('installedModified')}` : ''}
                {isInstalledRelease ? ` ${t('installedCurrent')}` : ''}
              </p>
            )}
          </>
        )}
        {conflict !== undefined && (
          <div className={css.warning} role="alert" data-testid="roleplay-catalogue-conflict">
            <p>{conflict.reason === 'modified' ? t('conflictModified') : t('conflictUnverified')}</p>
            {conflict.changes.length > 0 && <><p>{t('changesHeading')}</p><ul className={css.changes}>{conflict.changes.map(line => <li key={line}>{line}</li>)}</ul></>}
            <div className={css.actions}>
              <Button variant="outline" size="sm" onClick={() => { run('update', true) }}>{t('overwrite')}</Button>
              <Button variant="outline" size="sm" onClick={() => { run('copy') }}>{t('keepBoth')}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setConflict(undefined) }}>{t('dismiss')}</Button>
            </div>
          </div>
        )}
        {failure !== undefined && <p className={css.notice} role="alert">{failure}</p>}
        {done !== undefined && (
          <p className={css.success} role="status">
            {done.text}
            {done.backup === undefined ? '' : ` ${t('backupNotice', { backup: done.backup })}`}
            {done.packs.length > 0 ? ` ${t('packsNotice', { packs: done.packs.join(', ') })}` : ''}
            {done.untracked ? ` ${t('untracked')}` : ''}
          </p>
        )}
      </div>
    </Modal>
    {selecting !== undefined && <ImportSelectionDialog preview={selecting} t={t} canVerbatim onClose={() => { setSelecting(undefined) }} onConfirm={importChosen} />}
    </>
  )
}
