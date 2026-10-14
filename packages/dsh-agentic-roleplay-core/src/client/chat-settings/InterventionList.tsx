import type { Intervention } from '../../shared/interventions.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** What the story's triggers delivered lately, and whether the game master or the characters took it up, newest first. */
export function InterventionList({ t, entries }: { t: Translate; entries: readonly Intervention[] }) {
  const shown = [...entries].reverse()
  return (
    <details className={css.activity} data-testid="roleplay-interventions">
      <summary>{t('interventionsTitle')}</summary>
      <p className={css.description}>{t('interventionsHelp')}</p>
      {shown.length === 0
        ? <p className={css.description}>{t('interventionsEmpty')}</p>
        : (
          <table className={css.table}>
            <thead><tr><th>{t('interventionTurn')}</th><th>{t('interventionKind')}</th><th>{t('interventionText')}</th><th>{t('interventionStatus')}</th></tr></thead>
            <tbody>
              {shown.map(entry => (
                <tr key={`${entry.turn}-${entry.kind}-${entry.trigger}-${entry.text}`}>
                  <td>{entry.turn}</td>
                  <td>{entry.kind === 'beat' ? t('interventionBeat') : t('interventionCue', { who: entry.characters.join(', ') })}</td>
                  <td>{entry.text}</td>
                  <td>{t(entry.status === 'waiting' ? 'interventionWaiting' : entry.status === 'taken' ? 'interventionTaken' : 'interventionLapsed')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </details>
  )
}
