import { Button } from '../ui/Button.tsx'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** A way to have the story's plan made or revised now, whatever the automatic setting says. */
export function PlanSection({ t, onStart, disabled }: { t: Translate; onStart: () => void; disabled: boolean }) {
  return (
    <section className={css.activity} data-testid="roleplay-plan">
      <strong>{t('planTitle')}</strong>
      <div>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onStart}>{t('planNow')}</Button>
        <p className={css.description}>{t('planHelp')}</p>
      </div>
    </section>
  )
}
