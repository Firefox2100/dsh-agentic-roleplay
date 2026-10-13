import type { ActivityEntry } from '../../shared/activity.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** How many of the latest runs are listed. */
const SHOWN = 20

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`

/** What the story's helper agents did lately and how long it took, newest first, to see where a slow turn went or why a helper gave up. */
export function ActivityList({ t, entries, onRefresh }: { t: Translate; entries: readonly ActivityEntry[]; onRefresh: () => void }) {
  const shown = entries.slice(-SHOWN).reverse()
  return (
    <details className={css.activity} data-testid="roleplay-activity">
      <summary>{t('activityTitle')}</summary>
      <p className={css.description}>{t('activityHelp')}</p>
      <button type="button" className={css.link} onClick={onRefresh}>{t('activityRefresh')}</button>
      {shown.length === 0
        ? <p className={css.description}>{t('activityEmpty')}</p>
        : (
          <table className={css.table}>
            <thead><tr><th>{t('activityWhen')}</th><th>{t('activityHelper')}</th><th>{t('activityModel')}</th><th>{t('activityTook')}</th><th>{t('activityCalls')}</th><th>{t('activityResult')}</th></tr></thead>
            <tbody>
              {shown.map(entry => (
                <tr key={`${entry.at}-${entry.label}`}>
                  <td>{new Date(entry.at).toLocaleTimeString()}</td>
                  <td>{entry.label}</td>
                  <td>{entry.model === '' ? t('activityOwnModel') : entry.model}</td>
                  <td>{seconds(entry.ms)}</td>
                  <td>{entry.calls}</td>
                  <td className={entry.error === undefined ? undefined : css.error} title={entry.error}>{entry.error === undefined ? t('activityDone') : t('activityFailed', { reason: entry.error })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </details>
  )
}
