import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../ui/Button.tsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { pageCount, pageStart, pagingFor } from '../../paging/paging.ts'
import type {} from '../../panel/slot-contract.ts'
import { Pager } from '../../widgets/pager/Pager.tsx'
import { ProblemList } from '../../widgets/problem-list/ProblemList.tsx'
import { DeleteSessionDialog } from './DeleteSessionDialog.tsx'
import { ExportSessionDialog } from './ExportSessionDialog.tsx'
import { exportAddress, type ExportKind, type SessionsFace } from './sessions-controller.ts'
import { useRowFit } from './use-row-fit.ts'
import css from './SessionsPage.module.css'import { IconArchive, IconArchiveOff, IconDownload, IconPlay, IconRefresh, IconTrash } from '../../ui/icons.tsx'


export type SessionsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.sessions'>
  & InjectFace<SessionsFace>

/** The sessions as a table, one page at a time, the most recently played first. */
export function SessionsPage({ t, useRoleplaySessions, load, refresh, open, archive, restore, askExport, closeExport, importArchive, askRemoval, cancelRemoval, confirmRemoval, setEverywhere }: SessionsPageProps) {
  const state = useRoleplaySessions(snapshot => snapshot)
  const viewport = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const { pageSize, scrolls } = pagingFor(useRowFit(viewport))
  const [requestedStart, setRequestedStart] = useState(0)
  const dateLocale = t('dateLocale')
  const dateTime = useMemo(() => new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }), [dateLocale])

  // The list is read whenever the page opens, so a session started meanwhile is there.
  useEffect(() => { load() }, [load])

  const sessions = state.payload?.sessions ?? []
  const start = pageStart(requestedStart, sessions.length, pageSize)
  const pages = pageCount(sessions.length, pageSize)
  const visible = sessions.slice(start, start + pageSize)

  useEffect(() => { viewport.current?.scrollTo({ top: 0 }) }, [start])

  /** The host sends the file as a download, which the browser keeps. */
  const download = (kind: ExportKind): void => {
    if (state.exporting === undefined) return
    const link = document.createElement('a')
    link.href = exportAddress(state.exporting.id, kind)
    link.rel = 'noopener'
    link.click()
    closeExport()
  }

  const count = t(sessions.length === 1 ? 'countOne' : 'countOther', { count: sessions.length })
  const failedWithoutData = state.status === 'failed' && state.payload === undefined

  return (
    <div className={css.page} data-testid="roleplay-sessions-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.payload === undefined ? '' : count}</span>
        <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) importArchive(file) }} />
        <Button variant="outline" size="sm" disabled={state.importing === true} aria-busy={state.importing === true} onClick={() => { picker.current?.click() }}>
          {state.importing === true ? t('importing') : t('importStory')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefresh className={state.refreshing ? css.spinning : undefined} />}
          disabled={state.refreshing || state.status === 'loading'}
          aria-busy={state.refreshing}
          onClick={refresh}
        >
          {state.refreshing ? t('refreshing') : t('refresh')}
        </Button>
      </div>

      {state.error !== undefined && !failedWithoutData && (
        <p className={css.notice} role="alert">{t('loadFailed', { message: state.error })}</p>
      )}
      {state.moveError !== undefined && <p className={css.notice} role="alert">{t('moveFailed', { message: state.moveError })}</p>}
      {state.importError !== undefined && <p className={css.notice} role="alert">{t('importFailed', { message: state.importError })}</p>}
      {state.imported !== undefined && <p className={css.notice} role="status">{t(state.imported.worldAdded ? 'importedWithWorld' : 'imported', { name: state.imported.name })}</p>}
      {state.openError !== undefined && <p className={css.notice} role="alert">{t('openFailed', { message: state.openError })}</p>}
      <ProblemList summary={t('problems', { count: state.payload?.problems.length ?? 0 })} problems={state.payload?.problems ?? []} />

      <div ref={viewport} className={`${css.viewport} ${scrolls ? css.scrolls : css.fits}`}>
        {state.status === 'loading' || state.status === 'idle'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.message} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : sessions.length === 0
              ? <p className={css.message}>{t('empty')}</p>
              : (
                <table className={css.table}>
                  <colgroup>
                    <col className={css.nameColumn} />
                    <col className={css.worldColumn} />
                    <col className={css.timeColumn} />
                    <col className={css.timeColumn} />
                    <col className={css.turnsColumn} />
                    <col className={css.actionsColumn} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{t('columnName')}</th>
                      <th scope="col">{t('columnWorld')}</th>
                      <th scope="col">{t('columnCreated')}</th>
                      <th scope="col">{t('columnLastPlayed')}</th>
                      <th scope="col" className={css.number}>{t('columnTurns')}</th>
                      <th scope="col" className={css.actions}>{t('columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(session => (
                      <tr key={session.id} data-testid="session-row" className={session.archivedAt === undefined ? undefined : css.archived}>
                        <td className={css.name} data-label={t('columnName')} title={session.name}>{session.name}{session.archivedAt !== undefined && <span className={css.badge}>{t('archived')}</span>}</td>
                        <td className={css.secondary} data-label={t('columnWorld')} title={session.worldName}>{session.worldName}</td>
                        <td className={css.secondary} data-label={t('columnCreated')}>{dateTime.format(new Date(session.createdAt))}</td>
                        <td className={css.secondary} data-label={t('columnLastPlayed')}>
                          {session.lastPlayedAt === undefined ? t('neverPlayed') : dateTime.format(new Date(session.lastPlayedAt))}
                        </td>
                        <td className={`${css.secondary} ${css.number}`} data-label={t('columnTurns')}>{session.turns}</td>
                        <td className={css.actions} data-label={t('columnActions')}>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<IconPlay />}
                            aria-label={t('open')}
                            title={t('open')}
                            disabled={state.opening !== undefined || session.archivedAt !== undefined}
                            onClick={() => { open(session.id) }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<IconDownload />}
                            aria-label={t('export')}
                            title={t('export')}
                            onClick={() => { askExport(session.id, session.name) }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={session.archivedAt === undefined ? <IconArchive /> : <IconArchiveOff />}
                            aria-label={session.archivedAt === undefined ? t('archive') : t('restore')}
                            title={session.archivedAt === undefined ? t('archive') : t('restore')}
                            disabled={state.moving !== undefined}
                            onClick={() => { if (session.archivedAt === undefined) archive(session.id); else restore(session.id) }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<IconTrash />}
                            aria-label={t('delete')}
                            title={t('delete')}
                            onClick={() => { askRemoval(session.id, session.name) }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
      </div>

      {pages > 1 && (
        <Pager
          label={t('nav')}
          previousLabel={t('previousPage')}
          nextLabel={t('nextPage')}
          positionLabel={t('pageOf', { page: start / pageSize + 1, pages })}
          hasPrevious={start > 0}
          hasNext={start + pageSize < sessions.length}
          onPrevious={() => { setRequestedStart(start - pageSize) }}
          onNext={() => { setRequestedStart(start + pageSize) }}
        />
      )}

      {state.exporting !== undefined && <ExportSessionDialog key={state.exporting.id} t={t} name={state.exporting.name} onExport={download} onCancel={closeExport} />}

      {state.removal !== undefined && (
        <DeleteSessionDialog key={state.removal.id} t={t} removal={state.removal} onConfirm={confirmRemoval} onCancel={cancelRemoval} onEverywhere={setEverywhere} />
      )}
    </div>
  )
}
