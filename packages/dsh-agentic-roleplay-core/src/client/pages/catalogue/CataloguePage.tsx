import { useEffect, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogueKind, CatalogueUpdate, CatalogueWorld, CatalogueWorldPage } from '../../../shared/catalogue.ts'
import type {} from '../../panel/slot-contract.ts'
import { coverUrl, loadUpdates, loadWorlds } from './catalogue-api.ts'
import type { CatalogueFace } from './catalogue-controller.ts'
import { ImportUrlDialog } from './ImportUrlDialog.tsx'
import { WorldDialog } from './WorldDialog.tsx'
import css from './CataloguePage.module.css'

export type CataloguePageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.catalogue'>
  & InjectFace<CatalogueFace>

const hueOf = (name: string): number => Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0)

/** The worlds of the configured catalogues, to look through and install. */
export function CataloguePage({ t, useCatalogue, load, openChat }: CataloguePageProps) {
  const state = useCatalogue(snapshot => snapshot)
  const usable = state.sources.filter(source => source.problem === undefined)
  const [selected, setSelected] = useState('')
  const [kind, setKind] = useState<CatalogueKind>('world')
  const source = usable.find(candidate => candidate.name === selected) ?? usable[0]
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [sort, setSort] = useState<'recent' | 'popular'>('recent')
  const [page, setPage] = useState<{ items: CatalogueWorld[]; nextOffset?: number; withKey: boolean }>()
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  const [opened, setOpened] = useState<{ id: string; name: string; kind: CatalogueKind }>()
  const [updates, setUpdates] = useState<{ updates: CatalogueUpdate[]; problems: { worldName: string; message: string }[] }>()
  const [updatesError, setUpdatesError] = useState<string>()
  const [changed, setChanged] = useState(0)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string>()
  const request = useRef(0)

  useEffect(() => { load() }, [load])

  const sourceName = source?.name
  const hasKey = source?.hasKey
  useEffect(() => {
    if (sourceName === undefined) { setPage(undefined); return }
    const abort = new AbortController()
    const token = ++request.current
    setLoading(true); setError(undefined)
    loadWorlds(sourceName, kind, applied, sort, 0, abort.signal).then(
      (loaded: CatalogueWorldPage) => { if (token === request.current) { setPage(loaded); setLoading(false) } },
      (failure: unknown) => { if (token === request.current && !abort.signal.aborted) { setError(failure instanceof Error ? failure.message : String(failure)); setPage(undefined); setLoading(false) } },
    )
    return () => { abort.abort() }
    // The key is part of what is asked: when the settings add or remove it the worlds are asked for again.
  }, [sourceName, hasKey, kind, applied, sort, reload, state.revision])

  useEffect(() => {
    if (sourceName === undefined) { setUpdates(undefined); return }
    const abort = new AbortController()
    setUpdatesError(undefined)
    loadUpdates(sourceName, abort.signal).then(
      (found) => { setUpdates(found) },
      (failure: unknown) => { if (!abort.signal.aborted) { setUpdates(undefined); setUpdatesError(failure instanceof Error ? failure.message : String(failure)) } },
    )
    return () => { abort.abort() }
  }, [sourceName, hasKey, reload, changed, state.revision])

  const showMore = (): void => {
    if (source === undefined || page?.nextOffset === undefined) return
    const token = request.current
    setMore(true)
    loadWorlds(source.name, kind, applied, sort, page.nextOffset, new AbortController().signal).then(
      (next) => { if (token === request.current) { setPage({ items: [...page.items, ...next.items], ...(next.nextOffset === undefined ? {} : { nextOffset: next.nextOffset }), withKey: next.withKey }); setMore(false) } },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)); setMore(false) },
    )
  }

  const problems = state.sources.filter(entry => entry.problem !== undefined)
  return (
    <div className={css.page} data-testid="roleplay-catalogue-page">
      <div className={css.toolbar}>
        {usable.length > 1 && (
          <select className={css.select} value={source?.name ?? ''} aria-label={t('source')} onChange={(event) => { setSelected(event.target.value); setPage(undefined) }}>
            {usable.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
          </select>
        )}
        <form onSubmit={(event) => { event.preventDefault(); setApplied(search.trim()) }}>
          <input className={css.search} type="search" value={search} placeholder={kind === 'card' ? t('searchCardsPlaceholder') : t('searchPlaceholder')} aria-label={t('search')} disabled={source === undefined} onChange={(event) => { setSearch(event.target.value) }} />
        </form>
        <select className={css.select} value={sort} aria-label={t('sortRecent')} disabled={source === undefined} onChange={(event) => { setSort(event.target.value === 'popular' ? 'popular' : 'recent') }}>
          <option value="recent">{t('sortRecent')}</option>
          <option value="popular">{t('sortPopular')}</option>
        </select>
        <span className={css.spacer} />
        <Button variant="outline" size="sm" onClick={() => { setImporting(true) }}>{t('importUrl')}</Button>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={source === undefined || loading} onClick={() => { load(); setReload(count => count + 1) }}>{loading ? t('refreshing') : t('refresh')}</Button>
      </div>

      <div className={css.kinds} role="tablist">
        {(['world', 'card'] as const).map(entry => (
          <button key={entry} type="button" role="tab" className={css.kind} aria-selected={kind === entry} data-testid={`roleplay-catalogue-kind-${entry}`} onClick={() => { setKind(entry); setPage(undefined) }}>{entry === 'world' ? t('kindWorlds') : t('kindCards')}</button>
        ))}
      </div>

      {source !== undefined && <p className={css.status} data-testid="roleplay-catalogue-key">{source.hasKey ? t('withKey') : `${t('withoutKey')} ${t('withoutKeyHint')}`}</p>}
      {problems.map(entry => <p key={entry.name} className={css.notice} role="alert">{t('sourceProblem', { name: entry.name, problem: entry.problem ?? '' })}</p>)}
      {updatesError !== undefined && <p className={css.notice} role="alert">{t('updatesFailed', { message: updatesError })}</p>}
      {updates?.problems.map(problem => <p key={problem.worldName} className={css.notice} role="alert">{t('updatesProblem', { name: problem.worldName, message: problem.message })}</p>)}
      {kind === 'world' && updates !== undefined && updates.updates.length > 0 && (
        <ul className={css.updates} data-testid="roleplay-catalogue-updates">
          <li>{t('updatesAvailable')}</li>
          {updates.updates.map(update => <li key={update.worldId}><button type="button" className={css.update} onClick={() => { setOpened({ id: update.resourceId, name: update.worldName, kind: 'world' }) }}>{t('updateItem', { name: update.worldName, from: update.installedVersion, to: update.latest.version })}</button></li>)}
        </ul>
      )}
      {notice !== undefined && <p className={css.status} role="status">{notice}</p>}

      <div className={css.viewport}>
        {state.status === 'idle' || state.status === 'loading'
          ? <p className={css.message}>{t('loading')}</p>
          : state.status === 'failed'
            ? <p className={css.message} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : source === undefined
              ? <p className={css.message}>{t('noSources')} {t('noSourcesHint')}</p>
              : error !== undefined
                ? <p className={css.message} role="alert">{t('loadFailed', { message: error })}</p>
                : page === undefined
                  ? <p className={css.message}>{t('loading')}</p>
                  : page.items.length === 0
                    ? <p className={css.message}>{applied === '' ? (kind === 'card' ? t('emptyCards') : t('empty')) : t('emptySearch', { search: applied })}</p>
                    : (
                      <>
                        <ul className={css.grid}>
                          {page.items.map(world => (
                            <li key={world.id}>
                              <button type="button" className={css.card} data-testid="roleplay-catalogue-card" onClick={() => { setOpened({ id: world.id, name: world.name, kind: world.kind }) }}>
                                <span className={css.cover}>
                                  {world.hasCover
                                    ? <img className={css.image} src={coverUrl(source.name, world.id)} alt="" decoding="async" />
                                    : <span className={css.placeholder} style={{ '--rp-hue': hueOf(world.name) } as React.CSSProperties} aria-hidden="true">{Array.from(world.name)[0]?.toUpperCase()}</span>}
                                </span>
                                <span className={css.body}>
                                  <span className={css.name}>{world.name}</span>
                                  <span className={css.meta}>{world.author === '' ? '' : t('by', { author: world.author })}</span>
                                  <span className={css.tags}>
                                    {world.visibility !== 'public' && <Tag tone="neutral">{world.visibility === 'private' ? t('private') : t('members')}</Tag>}
                                    {world.tags.slice(0, 3).map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {page.nextOffset !== undefined && <div className={css.more}><Button variant="outline" size="sm" disabled={more} onClick={showMore}>{more ? t('loadingMore') : t('more')}</Button></div>}
                      </>
                    )}
      </div>

      {opened !== undefined && source !== undefined && <WorldDialog t={t} source={source} id={opened.id} name={opened.name} kind={opened.kind} openChat={openChat} onClose={() => { setOpened(undefined) }} onChanged={() => { setNotice(undefined); setChanged(count => count + 1) }} />}
      {importing && <ImportUrlDialog t={t} onClose={() => { setImporting(false) }} onInstalled={(name, packs) => { setImporting(false); setNotice(`${t('installed', { name })}${packs.length > 0 ? ` ${t('packsNotice', { packs: packs.join(', ') })}` : ''}`) }} />}
    </div>
  )
}
