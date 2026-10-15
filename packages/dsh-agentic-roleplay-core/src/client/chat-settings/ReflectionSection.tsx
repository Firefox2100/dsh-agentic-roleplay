import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReflectionStatus } from '../../shared/reflection.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const POLL_MS = 3000

/** When the characters last sorted what they took in, and a way to have them do it now. */
export function ReflectionSection({ t, status, onStart, onRefresh, disabled }: { t: Translate; status: ReflectionStatus; onStart: () => void; onRefresh: () => void; disabled: boolean }) {
  useEffect(() => {
    if (!status.running) return undefined
    const timer = setInterval(onRefresh, POLL_MS)
    return () => { clearInterval(timer) }
  }, [status.running, onRefresh])
  const reasons = { turns: t('reflectTurns'), scene: t('reflectScene'), manual: t('reflectManual') }
  return (
    <section className={css.activity} data-testid="roleplay-reflection">
      <strong>{t('reflectTitle')}</strong>
      <p className={css.description}>
        {status.running ? t('reflectRunning') : status.last === undefined ? t('reflectNone') : t('reflectLast', { turn: status.last.turn, reason: reasons[status.last.reason] })}
      </p>
      {!status.running && status.last !== undefined && (status.last.characters.length === 0
        ? <p className={css.description}>{t('reflectNothing')}</p>
        : <ul className={css.description}>{status.last.characters.map(entry => <li key={entry.name}>{t('reflectOutcome', { name: entry.name, added: entry.added, revised: entry.revised, dropped: entry.dropped })}</li>)}</ul>)}
      {status.error !== undefined && <p className={css.error} role="alert">{t('reflectError', { message: status.error.message })}</p>}
      <div>
        <Button variant="ghost" size="sm" disabled={disabled || status.running} onClick={onStart}>{t('reflectNow')}</Button>
        <p className={css.description}>{t('reflectHelp')}</p>
      </div>
    </section>
  )
}
