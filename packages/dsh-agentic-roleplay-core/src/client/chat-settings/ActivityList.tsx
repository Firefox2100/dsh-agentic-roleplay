import { useState } from 'react'
import type { ActivityEntry, RunDetail, RunRecall } from '../../shared/activity.ts'
import { loadRun } from './settings-api.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** How many of the latest runs are listed. */
const SHOWN = 20

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`

/** What the story's helper agents did lately and how long it took, newest first, to see where a slow turn went or why a helper gave up. */
export function ActivityList({ t, session, entries, onRefresh }: { t: Translate; session: string; entries: readonly ActivityEntry[]; onRefresh: () => void }) {
  const shown = entries.slice(-SHOWN).reverse()
  const [open, setOpen] = useState<{ run: string; detail: RunDetail | 'gone' | 'loading' | { error: string } } | undefined>()

  const toggle = (run: string): void => {
    if (open?.run === run) { setOpen(undefined); return }
    setOpen({ run, detail: 'loading' })
    loadRun(session, run, new AbortController().signal).then(
      (detail) => { setOpen(current => (current?.run === run ? { run, detail: detail ?? 'gone' } : current)) },
      (failure: unknown) => { setOpen(current => (current?.run === run ? { run, detail: { error: failure instanceof Error ? failure.message : String(failure) } } : current)) },
    )
  }

  return (
    <details className={css.activity} data-testid="roleplay-activity">
      <summary>{t('activityTitle')}</summary>
      <p className={css.description}>{t('activityHelp')}</p>
      <button type="button" className={css.link} onClick={onRefresh}>{t('activityRefresh')}</button>
      {shown.length === 0
        ? <p className={css.description}>{t('activityEmpty')}</p>
        : (
          <table className={css.table}>
            <thead><tr><th>{t('activityWhen')}</th><th>{t('activityHelper')}</th><th>{t('activityModel')}</th><th>{t('activityTook')}</th><th>{t('activityCalls')}</th><th>{t('activityResult')}</th><th /></tr></thead>
            <tbody>
              {shown.flatMap(entry => [
                <tr key={`${entry.at}-${entry.label}`}>
                  <td>{new Date(entry.at).toLocaleTimeString()}</td>
                  <td>{entry.label}</td>
                  <td>{entry.model === '' ? t('activityOwnModel') : entry.model}</td>
                  <td>{seconds(entry.ms)}</td>
                  <td>{entry.calls}</td>
                  <td className={entry.error === undefined ? undefined : css.error} title={entry.error}>{entry.error === undefined ? t('activityDone') : t('activityFailed', { reason: entry.error })}</td>
                  <td>{entry.run === undefined ? null : <button type="button" className={css.link} onClick={() => { toggle(entry.run as string) }}>{open?.run === entry.run ? t('runHide') : t('runShow')}</button>}</td>
                </tr>,
                ...(entry.run !== undefined && open?.run === entry.run
                  ? [<tr key={`${entry.at}-${entry.label}-run`}><td colSpan={7}><RunView t={t} detail={open.detail} /></td></tr>]
                  : []),
              ])}
            </tbody>
          </table>
        )}
    </details>
  )
}

function RunView({ t, detail }: { t: Translate; detail: RunDetail | 'gone' | 'loading' | { error: string } }) {
  if (detail === 'loading') return <p className={css.description}>{t('loading')}</p>
  if (detail === 'gone') return <p className={css.description}>{t('runGone')}</p>
  if ('error' in detail) return <p className={css.description} role="alert">{t('runFailed', { message: detail.error })}</p>
  return (
    <div className={css.run} data-testid="roleplay-run">
      <details><summary>{t('runPersona')}</summary><pre className={css.pre}>{detail.persona}</pre></details>
      <details open><summary>{t('runPrompt')}</summary><pre className={css.pre}>{detail.prompt}</pre></details>
      {detail.recalled !== undefined && detail.recalled.length > 0 && (
        <details>
          <summary>{t('runRecalled')}</summary>
          <ul className={css.reasons} data-testid="roleplay-run-recalled">
            {detail.recalled.map((memory, index) => <li key={index}>{`${memory.clarity}, turn ${memory.turn}: ${memory.text}`}<br />{whyText(t, memory.why)}</li>)}
          </ul>
        </details>
      )}
      {detail.calls.map((call, index) => (
        <details key={index}>
          <summary className={call.failed ? css.error : undefined}>{`${index + 1}. ${call.tool}${call.failed ? ` (${t('runRefused')})` : ''}`}</summary>
          <pre className={css.pre}>{call.args}</pre>
          <pre className={css.pre}>{call.outcome}</pre>
        </details>
      ))}
      <details><summary>{t('runResult')}</summary><pre className={css.pre}>{detail.result ?? t('runNoResult')}</pre></details>
    </div>
  )
}

const figure = (value: number): string => (Math.round(value * 100) / 100).toString()

/** The reasons a thing came back, one short line. */
function whyText(t: Translate, why: RunRecall['why']): string {
  if (why === undefined) return ''
  return [
    t('whyCues', { people: figure(why.cues.people), words: figure(why.cues.words), place: figure(why.cues.place) }),
    ...(why.lexical === undefined ? [] : [t('whyIndex', { value: figure(why.lexical) })]),
    ...(why.dense === undefined ? [] : [t('whyMeaning', { value: figure(why.dense) })]),
    ...(why.rerank === undefined ? [] : [t('whyRerank', { value: figure(why.rerank) })]),
    t('whyMatters', { value: why.importance }),
    t('whyAge', { value: figure(why.ageDays) }),
    ...(why.retention === undefined ? [] : [t('whyKept', { value: figure(why.retention) })]),
    t('whyScore', { value: figure(why.score) }),
    ...(why.linked === undefined ? [] : [t('whyLinked', { people: why.linked.people, tags: why.linked.tags, place: why.linked.place ? t('whyLinkedPlace') : '' })]),
  ].join(' · ')
}
