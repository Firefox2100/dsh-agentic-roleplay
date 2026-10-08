import { useMemo, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlotDefinition } from 'dsh-roleplay-model'
import type { WorldState } from '../../shared/world-state.ts'
import type { Translate } from './WorldEditor.tsx'
import type { WorldSource } from './source.ts'
import css from './CharactersPanel.module.css'

const newPlot = (): PlotDefinition => ({
  id: 'new-plot', name: 'New plot', premise: '', themes: [], hooks: [], developments: [], stakes: [], resolutions: [], participants: [], start: 'available',
  pacing: { quietTurns: 3, cooldownTurns: 4, cooldownDays: 1 },
})

export function PlotsPanel({ t, world, source, onChanged, actions }: { t: Translate; world: WorldState; source: WorldSource; onChanged: (world: WorldState) => void; actions: React.ReactNode }) {
  const original = useMemo(() => world.plots.map(entry => entry.definition), [world.plots])
  const [draft, setDraft] = useState(() => JSON.stringify(original, null, 2))
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
  const dirty = draft !== JSON.stringify(original, null, 2)
  const save = (): void => {
    let plots: PlotDefinition[]
    try { const value = JSON.parse(draft) as unknown; if (!Array.isArray(value)) throw new Error('expected a JSON list'); plots = value as PlotDefinition[] } catch (error) { setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) }); return }
    setStatus({ state: 'saving' })
    source.savePlots({ plots }, new AbortController().signal).then(next => { setDraft(JSON.stringify(next.plots.map(entry => entry.definition), null, 2)); setStatus({ state: 'saved' }); onChanged(next) }, failure => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
  }
  const add = (): void => { let plots: unknown[] = []; try { const value = JSON.parse(draft) as unknown; if (Array.isArray(value)) plots = value } catch {} setDraft(JSON.stringify([...plots, newPlot()], null, 2)); setStatus({ state: 'idle' }) }
  return <div className={css.panel}><div className={css.tabs}><Button variant="ghost" size="sm" onClick={add}>{t('addPlot')}</Button><span className={css.tabsSpace} />{actions}</div>{(dirty || status.state !== 'idle') && <div className={css.bar} role="status"><span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>{dirty && <Button variant="ghost" size="sm" onClick={() => { setDraft(JSON.stringify(original, null, 2)); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>}{dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving'} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}</div>}<div className={css.body}><article className={css.sheet}><p>{t('plotsHelp')}</p>{world.plots.some(entry => entry.progress !== undefined) && <section className={css.section}><h3 className={css.sectionTitle}>{t('plotProgress')}</h3>{world.plots.map(entry => entry.progress === undefined ? null : <div key={entry.definition.id}><strong>{entry.definition.name}</strong> <Tag>{entry.progress.status}</Tag> {entry.progress.introduced.length > 0 && <span>{t('introduced')}: {entry.progress.introduced.join(', ')}</span>} {entry.progress.rejected.length > 0 && <span> · {t('rejected')}: {entry.progress.rejected.join(', ')}</span>}</div>)}</section>}<textarea className={css.area} rows={28} aria-label={t('plotsJson')} value={draft} onChange={event => { setDraft(event.target.value); setStatus({ state: 'idle' }) }} /></article></div></div>
}
