import { useCallback, useEffect, useState } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorldState } from '../../shared/world-state.ts'
import { CharactersPanel } from './CharactersPanel.tsx'
import { PlacesPanel, ThingsPanel } from './EntityPanels.tsx'
import { FactionsPanel } from './FactionsPanel.tsx'
import { RelationsPanel } from './RelationsPanel.tsx'
import { LorePanel } from './LorePanel.tsx'
import type { WorldLocaleKey } from './locales.ts'
import { NotEditableError, type WorldSource } from './source.ts'
import css from './WorldEditor.module.css'

export type Translate = (key: WorldLocaleKey, values?: Record<string, string | number>) => string

type Load =
  | { status: 'loading' }
  | { status: 'not-editable' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; world: WorldState }

const SECTIONS = [
  { id: 'characters', label: 'characters', built: true },
  { id: 'places', label: 'places', built: true },
  { id: 'things', label: 'things', built: true },
  { id: 'factions', label: 'factions', built: true },
  { id: 'lore', label: 'lore', built: true },
  { id: 'relations', label: 'relationships', built: true },
] as const

/**
 * The world as it can be authored: a drawer of its parts and the part that is open. It reads from and saves to a source, so the same
 * editor serves the story of a session and the files of a world.
 */
export function WorldEditor({ t, source, notEditable }: { t: Translate; source: WorldSource; notEditable: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('characters')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    source.load(abort.signal).then(
      (world) => { setLoad({ status: 'ready', world }) },
      (failure: unknown) => {
        if (abort.signal.aborted) return
        setLoad(failure instanceof NotEditableError ? { status: 'not-editable' } : { status: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      },
    )
    return () => { abort.abort() }
  }, [source, reload])

  const refresh = useCallback(() => { setReload(count => count + 1) }, [])
  const changed = useCallback((world: WorldState) => { setLoad({ status: 'ready', world }) }, [])

  if (load.status === 'loading') return <p className={css.message}>{t('editorLoading')}</p>
  if (load.status === 'not-editable') return <p className={css.message}>{notEditable}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('editorLoadFailed', { message: load.message })}</p>

  return (
    <div className={css.view} data-testid="roleplay-world">
      <nav className={css.drawer} aria-label={t('sections')}>
        {SECTIONS.map(entry => (
          <button
            key={entry.id}
            type="button"
            className={`${css.drawerItem} ${entry.id === section ? css.drawerItemOn : ''}`}
            disabled={!entry.built}
            title={entry.built ? undefined : t('soon')}
            aria-current={entry.id === section ? 'page' : undefined}
            onClick={() => { setSection(entry.id) }}
          >
            {t(entry.label)}
          </button>
        ))}
      </nav>
      <div className={css.content}>
        {section === 'characters' && (
          <CharactersPanel
            t={t}
            world={load.world}
            source={source}
            onChanged={changed}
            actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>}
          />
        )}
        {section === 'places' && <PlacesPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'things' && <ThingsPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'factions' && <FactionsPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'lore' && <LorePanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'relations' && <RelationsPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
      </div>
    </div>
  )
}
