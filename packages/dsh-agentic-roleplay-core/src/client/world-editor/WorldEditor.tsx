import { useCallback, useEffect, useState } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorldState } from '../../shared/world-state.ts'
import { CharactersPanel } from './CharactersPanel.tsx'
import { PlacesPanel, ThingsPanel } from './EntityPanels.tsx'
import { FactionsPanel } from './FactionsPanel.tsx'
import { RelationsPanel } from './RelationsPanel.tsx'
import { LorePanel } from './LorePanel.tsx'
import { PlotsPanel } from './PlotsPanel.tsx'
import { PacksPanel } from './PacksPanel.tsx'
import { TriggersPanel } from './TriggersPanel.tsx'
import { InfoPanel } from './InfoPanel.tsx'
import { PromptsPanel } from './PromptsPanel.tsx'
import { RoutinesPanel } from './RoutinesPanel.tsx'
import { CalendarPanel } from './CalendarPanel.tsx'
import { VariablesPanel } from './VariablesPanel.tsx'
import { GalleryView } from '../widgets/gallery-view/GalleryView.tsx'
import type { WorldLocaleKey } from './locales.ts'
import type { GalleryLocaleKey } from '../widgets/gallery-view/locales.ts'
import { NotEditableError, type WorldSource } from './source.ts'
import css from './WorldEditor.module.css'
import { navigateEditorTabs } from './EditorTabs.tsx'

export type Translate = (key: WorldLocaleKey, values?: Record<string, string | number>) => string

type Load =
  | { status: 'loading' }
  | { status: 'not-editable' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; world: WorldState }

type SectionId = (typeof SECTIONS)[number]['id']

const SECTIONS = [
  { id: 'info', label: 'sectionInfo', built: true, ownFiles: true },
  { id: 'characters', label: 'characters', built: true },
  { id: 'places', label: 'places', built: true },
  { id: 'things', label: 'things', built: true },
  { id: 'factions', label: 'factions', built: true },
  { id: 'lore', label: 'lore', built: true },
  { id: 'plots', label: 'plots', built: true },
  { id: 'triggers', label: 'trig_title', built: true },
  { id: 'relations', label: 'relationships', built: true },
  { id: 'routines', label: 'sectionRoutines', built: true, ownFiles: true },
  { id: 'calendar', label: 'sectionCalendar', built: true, ownFiles: true },
  { id: 'variables', label: 'sectionVariables', built: true, ownFiles: true },
  { id: 'prompts', label: 'sectionPrompts', built: true, ownFiles: true },
  { id: 'interface', label: 'pk_title', built: true, ownFiles: true },
  { id: 'images', label: 'sectionImages', built: true, ownFiles: true },
] as const satisfies readonly { id: string; label: WorldLocaleKey; built: boolean; ownFiles?: boolean }[]

/**
 * The world as it can be authored: a drawer of its parts and the part that is open. It reads from and saves to a source, so the same
 * editor serves the story of a session and the files of a world.
 */
export function WorldEditor({ t, source, notEditable, only, warnNoPlayable = true, focus }: { t: Translate; source: WorldSource; notEditable: string; /** Shows just these parts, without the drawer when it is one. */ only?: readonly SectionId[]; warnNoPlayable?: boolean; /** The character that is open first. */ focus?: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [section, setSection] = useState<SectionId>(only?.[0] ?? (focus !== undefined || source.worldId === undefined ? 'characters' : 'info'))
  const sections = SECTIONS.filter(entry => (only === undefined || only.includes(entry.id)) && (!('ownFiles' in entry) || source.worldId !== undefined))
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

  const galleryText = useCallback((key: GalleryLocaleKey, values?: Record<string, string | number>) => t(`gallery_${key}`, values), [t])
  const refresh = useCallback(() => { setReload(count => count + 1) }, [])
  const changed = useCallback((world: WorldState) => { setLoad({ status: 'ready', world }) }, [])

  if (load.status === 'loading') return <p className={css.message}>{t('editorLoading')}</p>
  if (load.status === 'not-editable') return <p className={css.message}>{notEditable}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('editorLoadFailed', { message: load.message })}</p>

  return (
    <div className={css.view} data-testid="roleplay-world" onKeyDownCapture={navigateEditorTabs}>
      {sections.length > 1 && <nav className={css.drawer} aria-label={t('sections')}>
        {sections.map(entry => (
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
      </nav>}
      <div className={css.content}>
        {warnNoPlayable && !load.world.characters.some(character => character.role === 'playable' || character.control === 'player') && <p className={css.warning} role="status" data-testid="roleplay-no-playable">{t('noPlayableWarning')}</p>}
        {section === 'info' && source.worldId !== undefined && <InfoPanel t={t} worldId={source.worldId} onSaved={refresh} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'prompts' && source.worldId !== undefined && <PromptsPanel t={t} worldId={source.worldId} language={t('language')} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'routines' && source.worldId !== undefined && <RoutinesPanel t={t} worldId={source.worldId} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'calendar' && source.worldId !== undefined && <CalendarPanel t={t} worldId={source.worldId} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'variables' && source.worldId !== undefined && <VariablesPanel t={t} worldId={source.worldId} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'interface' && source.worldId !== undefined && <PacksPanel t={t} worldId={source.worldId} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'images' && source.worldId !== undefined && <GalleryView t={galleryText} target={{ kind: 'worlds', id: source.worldId }} />}
        {section === 'characters' && (
          <CharactersPanel
            t={t}
            {...focus === undefined ? {} : { initial: focus }}
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
        {section === 'plots' && <PlotsPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'triggers' && <TriggersPanel t={t} world={load.world} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
        {section === 'relations' && <RelationsPanel t={t} world={load.world} source={source} onChanged={changed} actions={<Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} onClick={refresh}>{t('editorRefresh')}</Button>} />}
      </div>
    </div>
  )
}
