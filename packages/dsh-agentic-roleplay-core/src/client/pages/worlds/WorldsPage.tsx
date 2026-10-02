import { useEffect, useRef, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../../panel/slot-contract.ts'
import { WorldCard } from '../../widgets/world-card/WorldCard.tsx'
import { pageCount, pageStart, pagingFor } from './grid-layout.ts'
import { useGridFit } from './use-grid-fit.ts'
import type { WorldsFace } from './worlds-controller.ts'
import css from './WorldsPage.module.css'

export type WorldsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.worlds'>
  & InjectFace<WorldsFace>

/** The worlds, one page of cards at a time. */
export function WorldsPage({ t, useWorlds, load, refresh }: WorldsPageProps) {
  const state = useWorlds(snapshot => snapshot)
  const viewport = useRef<HTMLDivElement>(null)
  const { pageSize, scrolls } = pagingFor(useGridFit(viewport))
  const [requestedStart, setRequestedStart] = useState(0)

  useEffect(() => { load() }, [load])

  const worlds = state.payload?.worlds ?? []
  const problems = state.payload?.problems ?? []
  const start = pageStart(requestedStart, worlds.length, pageSize)
  const pages = pageCount(worlds.length, pageSize)
  const visible = worlds.slice(start, start + pageSize)

  useEffect(() => { viewport.current?.scrollTo({ top: 0 }) }, [start])

  const count = t(worlds.length === 1 ? 'countOne' : 'countOther', { count: worlds.length })
  const failedWithoutData = state.status === 'failed' && state.payload === undefined

  return (
    <div className={css.page} data-testid="roleplay-worlds-page">
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
      {problems.length > 0 && (
        <details className={css.problems}>
          <summary>{t('problems', { count: problems.length })}</summary>
          <ul>
            {problems.map(problem => (
              <li key={`${problem.path}:${problem.message}`}><code>{problem.path}</code> {problem.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div ref={viewport} className={`${css.viewport} ${scrolls ? css.scrolls : css.fits}`}>
        {state.status === 'loading' || state.status === 'idle'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.message} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : worlds.length === 0
              ? <p className={css.message}>{t('empty', { directory: state.payload?.directory ?? '' })}</p>
              : (
                <ul className={css.grid}>
                  {visible.map(world => <li key={world.id} className={css.cell}><WorldCard world={world} /></li>)}
                </ul>
              )}
      </div>

      {pages > 1 && (
        <nav className={css.pager} aria-label={t('nav')}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconChevronLeftOutlineRegular />}
            aria-label={t('previousPage')}
            disabled={start === 0}
            onClick={() => { setRequestedStart(start - pageSize) }}
          />
          <span className={css.pageLabel}>{t('pageOf', { page: start / pageSize + 1, pages })}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconChevronRightOutlineRegular />}
            aria-label={t('nextPage')}
            disabled={start + pageSize >= worlds.length}
            onClick={() => { setRequestedStart(start + pageSize) }}
          />
        </nav>
      )}
    </div>
  )
}
