import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconPlayOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { pageCount, pageStart, pagingFor } from '../../paging/paging.ts'
import type {} from '../../panel/slot-contract.ts'
import { Pager } from '../../widgets/pager/Pager.tsx'
import { ProblemList } from '../../widgets/problem-list/ProblemList.tsx'
import { DeleteSessionDialog } from './DeleteSessionDialog.tsx'
import type { SessionsFace } from './sessions-controller.ts'
import { useRowFit } from './use-row-fit.ts'
import css from './SessionsPage.module.css'

export type SessionsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.sessions'>
  & InjectFace<SessionsFace>

/** The sessions as a table, one page at a time, the most recently played first. */
export function SessionsPage({ t, useSessions, load, refresh, open, askRemoval, cancelRemoval, confirmRemoval }: SessionsPageProps) {
  const state = useSessions(snapshot => snapshot)
  const viewport = useRef<HTMLDivElement>(null)
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

  const count = t(sessions.length === 1 ? 'countOne' : 'countOther', { count: sessions.length })
  const failedWithoutData = state.status === 'failed' && state.payload === undefined

  return (
    <div className={css.page} data-testid="roleplay-sessions-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.payload === undefined ? '' : count}</span>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutlineRegular className={state.refreshing ? css.spinning : undefined} />}
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
                      <tr key={session.id} data-testid="session-row">
                        <td className={css.name} title={session.name}>{session.name}</td>
                        <td className={css.secondary} title={session.worldName}>{session.worldName}</td>
                        <td className={css.secondary}>{dateTime.format(new Date(session.createdAt))}</td>
                        <td className={css.secondary}>
                          {session.lastPlayedAt === undefined ? t('neverPlayed') : dateTime.format(new Date(session.lastPlayedAt))}
                        </td>
                        <td className={`${css.secondary} ${css.number}`}>{session.turns}</td>
                        <td className={css.actions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<IconPlayOutlineRegular />}
                            aria-label={t('open')}
                            title={t('open')}
                            disabled={state.opening !== undefined}
                            onClick={() => { open(session.id) }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<IconTrashOutlineRegular />}
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

      {state.removal !== undefined && (
        <DeleteSessionDialog key={state.removal.id} t={t} removal={state.removal} onConfirm={confirmRemoval} onCancel={cancelRemoval} />
      )}
    </div>
  )
}
