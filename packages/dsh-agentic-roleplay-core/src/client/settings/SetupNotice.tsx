import { useEffect, useState } from 'react'
import type { SettingsLocaleKey } from './locales.ts'
import { loadRedundantLayers } from './setup-api.ts'
import css from './CatalogueSettings.module.css'

/** Says why the settings cannot be saved when the profile holds a plugin row twice; nothing is shown otherwise. */
export function SetupNotice({ t }: { t: (key: SettingsLocaleKey) => string }) {
  const [rows, setRows] = useState<string[]>([])
  useEffect(() => {
    const abort = new AbortController()
    loadRedundantLayers(abort.signal).then(setRows, () => undefined)
    return () => { abort.abort() }
  }, [])
  if (rows.length === 0) return null
  return <p className={css.problem} role="alert" data-testid="roleplay-redundant-layers">{t('redundantLayers')} ({rows.join(', ')})</p>
}
