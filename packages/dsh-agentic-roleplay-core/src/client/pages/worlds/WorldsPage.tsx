import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconRefreshOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { pageCount, pageStart, pagingFor } from '../../paging/paging.ts'
import type {} from '../../panel/slot-contract.ts'
import { Pager } from '../../widgets/pager/Pager.tsx'
import { ProblemList } from '../../widgets/problem-list/ProblemList.tsx'
import { WorldCard } from '../../widgets/world-card/WorldCard.tsx'
import { WorldEditor } from '../../world-editor/WorldEditor.tsx'
import { worldSource } from '../../world-editor/authored-world-source.ts'
import { StartSessionDialog } from './StartSessionDialog.tsx'
import { useGridFit } from './use-grid-fit.ts'
import { CreateWorldDialog } from './CreateWorldDialog.tsx'
import { ImportCardPage } from './ImportCardPage.tsx'
import { uploadCard } from './import-api.ts'
import type { ImportPreview } from '../../../shared/import-card.ts'
import type { WorldsFace } from './worlds-controller.ts'
import css from './WorldsPage.module.css'

export type WorldsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.worlds'>
  & InjectFace<WorldsFace>

/** The worlds, one page of cards at a time. */
export function WorldsPage({ t, useWorlds, load, refresh, openStartDialog, closeStartDialog, startSession, dismissStarted, openAuthoring, openChat }: WorldsPageProps) {
  const state = useWorlds(snapshot => snapshot)
  const viewport = useRef<HTMLDivElement>(null)
  const { pageSize, scrolls } = pagingFor(useGridFit(viewport))
  const [requestedStart, setRequestedStart] = useState(0)
  const [editing, setEditing] = useState<{ id: string; name: string } | undefined>()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState<ImportPreview | undefined>()
  const [uploading, setUploading] = useState(false)
  const [importNotice, setImportNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)
  const source = useMemo(() => (editing === undefined ? undefined : worldSource(editing.id)), [editing])

  useEffect(() => { load() }, [load])

  const worlds = state.payload?.worlds ?? []
  const start = pageStart(requestedStart, worlds.length, pageSize)
  const pages = pageCount(worlds.length, pageSize)
  const visible = worlds.slice(start, start + pageSize)

  useEffect(() => { viewport.current?.scrollTo({ top: 0 }) }, [start])

  const count = t(worlds.length === 1 ? 'countOne' : 'countOther', { count: worlds.length })
  const failedWithoutData = state.status === 'failed' && state.payload === undefined

  const chooseCard = (file: File | undefined): void => {
    if (file === undefined) return
    setUploading(true)
    setImportNotice(undefined)
    uploadCard(file).then(
      (preview) => { setUploading(false); setImporting(preview) },
      (failure: unknown) => { setUploading(false); setImportNotice(t('importUploadFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    )
  }

  if (importing !== undefined) {
    return (
      <div className={css.page} data-testid="roleplay-world-import">
        <ImportCardPage
          t={t}
          preview={importing}
          onCancelled={() => { setImporting(undefined) }}
          onStarted={(chat, started) => { setImporting(undefined); refresh(); if (!started) setImportNotice(t('importNotStarted')); openChat(chat) }}
        />
      </div>
    )
  }

  if (editing !== undefined && source !== undefined) {
    return (
      <div className={css.page} data-testid="roleplay-world-editor">
        <div className={css.editHeader}>
          <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular />} onClick={() => { setEditing(undefined) }}>{t('back')}</Button>
          <span className={css.editTitle}>{editing.name}</span>
          <Button className={css.authorButton} variant="primary" size="sm" disabled={state.authoring?.worldId === editing.id && state.authoring.error === undefined} onClick={() => { openAuthoring(editing.id, t('authoringChatTitle', { name: editing.name })) }}>
            {state.authoring?.worldId === editing.id && state.authoring.error === undefined ? t('openingAuthor') : t('authorWorld')}
          </Button>
        </div>
        {state.authoring?.worldId === editing.id && state.authoring.error !== undefined && <p className={css.notice} role="alert">{t('authorWorldFailed', { message: state.authoring.error })}</p>}
        <div className={css.editBody}>
          <WorldEditor t={t} source={source} notEditable={t('worldMissing')} />
        </div>
      </div>
    )
  }

  return (
    <div className={css.page} data-testid="roleplay-worlds-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.payload === undefined ? '' : count}</span>
        <div className={css.toolbarActions}><Button variant="primary" size="sm" onClick={() => { setCreating(true) }}>{t('createWorld')}</Button><Button variant="outline" size="sm" disabled={uploading} onClick={() => { picker.current?.click() }}>{uploading ? t('importUploading') : t('importCard')}</Button><input ref={picker} type="file" accept=".png,.json,image/png,application/json" hidden onChange={(event) => { chooseCard(event.target.files?.[0]); event.target.value = '' }} /><Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutlineRegular className={state.refreshing ? css.spinning : undefined} />}
          disabled={state.refreshing || state.status === 'loading'}
          aria-busy={state.refreshing}
          onClick={refresh}
        >
          {state.refreshing ? t('refreshing') : t('refresh')}
        </Button></div>
      </div>

      {importNotice !== undefined && <p className={css.notice} role="alert">{importNotice}</p>}
      {state.error !== undefined && !failedWithoutData && (
        <p className={css.notice} role="alert">{t('loadFailed', { message: state.error })}</p>
      )}
      <ProblemList summary={t('problems', { count: state.payload?.problems.length ?? 0 })} problems={state.payload?.problems ?? []} />

      <div ref={viewport} className={`${css.viewport} ${scrolls ? css.scrolls : css.fits}`}>
        {state.status === 'loading' || state.status === 'idle'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.message} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : worlds.length === 0
              ? <p className={css.message}>{t('empty', { directory: state.payload?.directory ?? '' })}</p>
              : (
                <ul className={css.grid}>
                  {visible.map(world => (
                    <li key={world.id} className={css.cell}>
                      <WorldCard
                        world={world}
                        playLabel={t('play')}
                        onPlay={() => { openStartDialog(world.id, world.name) }}
                        onOpen={() => { setEditing({ id: world.id, name: world.name }) }}
                      />
                    </li>
                  ))}
                </ul>
              )}
      </div>

      {pages > 1 && (
        <Pager
          label={t('nav')}
          previousLabel={t('previousPage')}
          nextLabel={t('nextPage')}
          positionLabel={t('pageOf', { page: start / pageSize + 1, pages })}
          hasPrevious={start > 0}
          hasNext={start + pageSize < worlds.length}
          onPrevious={() => { setRequestedStart(start - pageSize) }}
          onNext={() => { setRequestedStart(start + pageSize) }}
        />
      )}

      {state.dialog !== undefined && (
        <StartSessionDialog key={state.dialog.worldId} t={t} dialog={state.dialog} onStart={startSession} onClose={closeStartDialog} />
      )}
      {creating && <CreateWorldDialog t={t} onClose={() => { setCreating(false) }} onCreated={(world) => { setCreating(false); setEditing({ id: world.id, name: world.name }); refresh() }} />}
      {state.started !== undefined && (
        <Toast key={state.started.sequence} text={t('chatNotOpened', { name: state.started.sessionName, message: state.started.reason })} onDone={dismissStarted} />
      )}
    </div>
  )
}
