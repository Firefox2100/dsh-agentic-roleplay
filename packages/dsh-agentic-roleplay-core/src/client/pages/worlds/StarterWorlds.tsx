import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StarterWorld } from '../../../shared/starter.ts'
import { addStarter, loadStarters } from './starter-api.ts'
import type { WorldsLocaleKey } from './locales.ts'
import css from './WorldsPage.module.css'

type Translate = (key: WorldsLocaleKey, values?: Record<string, string | number>) => string

/** The worlds that ship with the plugin and are not yet the person's, offered where the list of worlds is empty. */
export function StarterWorlds({ t, onAdded }: { t: Translate; onAdded: () => void }) {
  const [offered, setOffered] = useState<StarterWorld[]>([])
  const [adding, setAdding] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    loadStarters(abort.signal).then(
      (found) => { setOffered(found.filter(world => !world.installed)) },
      (failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => { abort.abort() }
  }, [])

  const add = (folder: string): void => {
    setAdding(folder)
    setError(undefined)
    addStarter(folder).then(
      () => { setAdding(undefined); onAdded() },
      (failure: unknown) => { setAdding(undefined); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }

  if (offered.length === 0 && error === undefined) return null
  return (
    <div className={css.starters} data-testid="roleplay-starters">
      {offered.map(world => (
        <div key={world.folder} className={css.starter}>
          <strong>{world.name}</strong>
          <span>{world.description.split('\n')[0]}</span>
          <Button variant="primary" size="sm" disabled={adding !== undefined} onClick={() => { add(world.folder) }}>{adding === world.folder ? t('starterAdding') : t('starterAdd')}</Button>
        </div>
      ))}
      {error !== undefined && <p className={css.notice} role="alert">{t('starterFailed', { message: error })}</p>}
    </div>
  )
}
