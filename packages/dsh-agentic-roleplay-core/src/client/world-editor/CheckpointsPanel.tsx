import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import type { CheckpointDiff, CheckpointInfo } from '../../shared/checkpoints.ts'
import type { CheckpointsLocaleKey } from './checkpoints-locales.ts'
import { compareCheckpoint, loadCheckpoints, makeCheckpoint, restoreCheckpoint } from './world-files-api.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'
import own from './CheckpointsPanel.module.css'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The copies of a world's files kept for taking its authoring back: when each was made, how the world differs from it now, and putting the world back as it was. */
export function CheckpointsPanel({ t, worldId, actions, onRestored }: { t: Translate; worldId: string; actions: React.ReactNode; onRestored: () => void }) {
  const say = useCallback((key: CheckpointsLocaleKey, values?: Record<string, string | number>): string => t(`cp_${key}`, values), [t])
  const [list, setList] = useState<CheckpointInfo[] | { failed: string } | undefined>()
  const [label, setLabel] = useState('')
  const [open, setOpen] = useState<{ id: string; diff?: CheckpointDiff } | undefined>()
  const [confirming, setConfirming] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)

  const read = useCallback((signal: AbortSignal) => {
    loadCheckpoints(worldId, signal).then(setList, (failure: unknown) => { if (!signal.aborted) setList({ failed: messageOf(failure) }) })
  }, [worldId])
  useEffect(() => {
    const abort = new AbortController()
    read(abort.signal)
    return () => { abort.abort() }
  }, [read])

  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    setError(undefined)
    setDone(false)
    work().catch((failure: unknown) => { setError(messageOf(failure)) }).finally(() => { setBusy(false) })
  }
  const create = (): void => run(async () => { await makeCheckpoint(worldId, label, new AbortController().signal); setLabel(''); read(new AbortController().signal) })
  const compare = (id: string): void => {
    if (open?.id === id) { setOpen(undefined); return }
    setOpen({ id })
    run(async () => { const diff = await compareCheckpoint(worldId, id, new AbortController().signal); setOpen({ id, diff }) })
  }
  const restore = (id: string): void => run(async () => {
    await restoreCheckpoint(worldId, id, new AbortController().signal)
    setConfirming(undefined)
    setOpen(undefined)
    setDone(true)
    read(new AbortController().signal)
    onRestored()
  })
  const reason = (entry: CheckpointInfo): string => (entry.reason === 'turn' ? say('reasonTurn', { turn: entry.turn ?? 0 }) : entry.reason === 'before-restore' ? say('reasonBefore') : entry.label === '' ? say('reasonManual') : entry.label)
  const paths = (title: string, files: string[]) => files.length === 0 ? null : <><p className={own.diffTitle}>{title}</p><ul className={own.diff}>{files.map(path => <li key={path}>{path}</li>)}</ul></>

  return (
    <div className={css.panel} data-testid="roleplay-world-checkpoints">
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      <div className={css.body}>
        <article className={css.sheet}>
          <h3 className={css.sectionTitle}>{say('title')}</h3>
          <p className={css.help}>{say('help')}</p>
          <div className={own.create}>
            <input className={own.createInput} value={label} placeholder={say('labelPlaceholder')} aria-label={say('create')} disabled={busy} onChange={(event) => { setLabel(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') create() }} />
            <Button variant="outline" size="sm" disabled={busy} onClick={create}>{say('create')}</Button>
          </div>
          {error !== undefined && <p className={css.error} role="alert">{say('failed', { message: error })}</p>}
          {done && <p className={own.notice} role="status">{say('restored')}</p>}
          {list === undefined && <p className={css.empty}>{say('loading')}</p>}
          {list !== undefined && 'failed' in list && <p className={css.error} role="alert">{say('loadFailed', { message: list.failed })}</p>}
          {Array.isArray(list) && list.length === 0 && <p className={css.empty}>{say('empty')}</p>}
          {Array.isArray(list) && list.length > 0 && (
            <ul className={own.list}>
              {list.map(entry => (
                <li key={entry.id} className={own.item}>
                  <div className={own.head}>
                    <span className={own.what}>{reason(entry)}</span>
                    <span className={own.when}>{new Date(entry.at).toLocaleString(t('language'))} · {say('files', { count: entry.files })}</span>
                    <span className={own.buttons}>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => { compare(entry.id) }}>{open?.id === entry.id ? say('hideCompare') : say('compare')}</Button>
                      {confirming === entry.id
                        ? <><Button variant="primary" size="sm" disabled={busy} onClick={() => { restore(entry.id) }}>{busy ? say('working') : say('confirmRestore')}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setConfirming(undefined) }}>{say('cancel')}</Button></>
                        : <Button variant="outline" size="sm" disabled={busy} onClick={() => { setConfirming(entry.id) }}>{say('restore')}</Button>}
                    </span>
                  </div>
                  {open?.id === entry.id && open.diff !== undefined && (
                    open.diff.changed.length + open.diff.added.length + open.diff.removed.length === 0
                      ? <p className={own.when}>{say('same')}</p>
                      : <>{paths(say('changed'), open.diff.changed)}{paths(say('added'), open.diff.added)}{paths(say('removed'), open.diff.removed)}</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </div>
  )
}
