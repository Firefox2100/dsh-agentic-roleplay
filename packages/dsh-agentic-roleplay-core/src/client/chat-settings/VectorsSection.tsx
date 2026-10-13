import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VectorStatus } from '../../shared/vectors.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** What the search by meaning stands on, and a way to start it again with another embedding model. */
export function VectorsSection({ t, status, onReset, disabled }: { t: Translate; status: VectorStatus; onReset: () => void; disabled: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <section className={css.activity} data-testid="roleplay-vectors">
      <strong>{t('vectorsTitle')}</strong>
      <p className={css.description}>
        {!status.available
          ? t('vectorsUnavailable')
          : status.model === undefined
            ? t('vectorsNone', { pending: status.pending })
            : t('vectorsStored', { model: status.model, dimensions: status.dimensions ?? 0, embedded: status.embedded, pending: status.pending })}
      </p>
      {status.model !== undefined && (
        <div>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { if (sure) { setSure(false); onReset() } else setSure(true) }}>{sure ? t('vectorsConfirm') : t('vectorsReset')}</Button>
          {sure && <button type="button" className={css.link} onClick={() => { setSure(false) }}>{t('vectorsCancel')}</button>}
          <p className={css.description}>{t('vectorsHelp')}</p>
        </div>
      )}
    </section>
  )
}
