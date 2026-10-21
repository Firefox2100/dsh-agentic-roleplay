import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LorebookStatus } from '../../shared/lorebooks.ts'
import { addStoryLorebook, loadStoryLorebooks, removeStoryLorebook } from '../lorebooks-api.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/** The lorebooks the story holds, with a way to add one from the library or take one out. */
export function LorebookSection({ t, session, disabled }: { t: Translate; session: string; disabled: boolean }) {
  const [status, setStatus] = useState<LorebookStatus>()
  const [choice, setChoice] = useState('')
  const [failure, setFailure] = useState<string>()
  const [report, setReport] = useState<string[]>([])
  const [leaving, setLeaving] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    loadStoryLorebooks(session, abort.signal).then(
      (next) => { setStatus(next); setFailure(undefined) },
      (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) },
    )
    return () => { abort.abort() }
  }, [session, version])

  const done = (lines: string[]): void => { setReport(lines); setFailure(undefined); setChoice(''); setLeaving(undefined); setVersion(number => number + 1) }
  const refused = (error: unknown): void => { setReport([]); setLeaving(undefined); setFailure(t('lorebookFailed', { message: message(error) })) }
  const add = (): void => {
    addStoryLorebook(session, choice, new AbortController().signal).then(
      (added) => { done([t('lorebookAdded', { count: added.entries }), ...added.notes]) },
      refused,
    )
  }
  const take = (name: string): void => {
    removeStoryLorebook(session, name, new AbortController().signal).then(
      (taken) => { done([t('lorebookRemoved', { count: taken.removed })]) },
      refused,
    )
  }

  if (status === undefined) return failure === undefined ? null : <p className={css.error} role="alert">{t('lorebookLoadFailed', { message: failure })}</p>
  const held = new Set(status.applied.map(book => book.name))
  const offered = status.available.filter(book => !held.has(book.name))
  if (status.applied.length === 0 && offered.length === 0) return null
  const titleOf = (name: string): string => status.available.find(book => book.name === name)?.title ?? name
  return (
    <section className={css.activity} data-testid="roleplay-lorebooks">
      <strong>{t('lorebookTitle')}</strong>
      <p className={css.description}>{t('lorebookHelp')}</p>
      <p className={css.description}>{status.applied.length === 0 ? t('lorebookNone') : t('lorebookHeld')}</p>
      {status.applied.map(book => (
        <div key={book.name}>
          <span>{t('lorebookRow', { name: titleOf(book.name), count: book.entries })}</span>{' '}
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { if (leaving === book.name) take(book.name); else setLeaving(book.name) }}>
            {leaving === book.name ? t('lorebookConfirmRemove') : t('lorebookRemove')}
          </Button>
          {leaving === book.name && <button type="button" className={css.link} onClick={() => { setLeaving(undefined) }}>{t('vectorsCancel')}</button>}
        </div>
      ))}
      {offered.length > 0 && (
        <>
          <label className={css.field} style={{ maxWidth: 'none' }}>
            <span className={css.label}>{t('lorebookChoose')}</span>
            <select className={css.select} value={choice} disabled={disabled} onChange={(event) => { setChoice(event.target.value) }}>
              <option value="">{t('lorebookKeep')}</option>
              {offered.map(book => <option key={book.name} value={book.name} disabled={book.problems.length > 0}>{book.problems.length > 0 ? t('lorebookBroken', { name: book.title }) : book.title}</option>)}
            </select>
          </label>
          {choice !== '' && <div><Button variant="ghost" size="sm" disabled={disabled} onClick={add}>{t('lorebookAdd')}</Button></div>}
        </>
      )}
      {report.map(line => <p key={line} className={css.description} role="status">{line}</p>)}
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </section>
  )
}
