import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoutineDefinition } from 'dsh-roleplay-model'
import type { WorldRoutines } from '../../shared/world-daily.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadRoutines, saveRoutine } from './world-files-api.ts'
import css from './CharactersPanel.module.css'
import { navigateEditorTabs } from './EditorTabs.tsx'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const BLANK: RoutineDefinition = { days: [], from: '08:00', to: '12:00', activity: '', interruptible: true }
const same = (a: readonly RoutineDefinition[], b: readonly RoutineDefinition[]): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The day each character lives: windows of the day with what it does, where and on which days, and whether it would drop it. */
export function RoutinesPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [world, setWorld] = useState<WorldRoutines>()
  const [chosen, setChosen] = useState<string>()
  const [drafts, setDrafts] = useState<Record<string, RoutineDefinition[]>>({})
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const abort = new AbortController()
    loadRoutines(worldId, abort.signal).then(setWorld, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (world === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>
  const character = world.characters.find(entry => entry.key === chosen) ?? world.characters[0]
  if (character === undefined) return <p className={css.empty}>{t('routinesNoCharacters')}</p>
  const draft = drafts[character.key] ?? character.routine
  const dirty = !same(draft, character.routine)
  const change = (windows: RoutineDefinition[]): void => { setDrafts({ ...drafts, [character.key]: windows }); setStatus({ state: 'idle' }) }
  const patch = (index: number, fields: Partial<RoutineDefinition>): void => { change(draft.map((window, at) => (at === index ? { ...window, ...fields } : window))) }
  const discard = (): void => { setDrafts(({ [character.key]: _, ...rest }) => rest); setStatus({ state: 'idle' }) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveRoutine(worldId, character.key, draft, new AbortController().signal).then((next) => { setWorld(next); discard(); setStatus({ state: 'saved' }) }, (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
  }
  const optional = (value: string): { location?: string } => (value === '' ? {} : { location: value })

  return (
    <div className={css.panel} data-testid="roleplay-routines">
      <div className={css.tabs} role="tablist" aria-label={t('characters')} onKeyDown={navigateEditorTabs}>
        {world.characters.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={entry.key === character.key} tabIndex={entry.key === character.key ? 0 : -1} className={`${css.tab} ${entry.key === character.key ? css.tabOn : ''}`} onClick={() => { setChosen(entry.key); setStatus({ state: 'idle' }) }}>{entry.name}</button>)}
        <span className={css.tabsSpace} />{actions}
      </div>
      {(dirty || status.state !== 'idle') && (
        <div className={css.bar} role="status">
          <span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>
          {dirty && <Button variant="ghost" size="sm" onClick={discard}>{t('reset')}</Button>}
          {dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving'} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}
        </div>
      )}
      <div className={css.body}>
        <article className={css.sheet}>
          <span className={css.help}>{t('routinesHelp')}</span>
          {draft.map((window, index) => {
            const place = world.places.find(entry => entry.key === window.location)
            return (
              <section className={css.section} key={index} data-testid="roleplay-routine-window">
                <div className={css.grid}>
                  <label className={css.field}><span className={css.label}>{t('routineFrom')}</span><input className={css.nameInput} value={window.from} placeholder="07:30" onChange={(event) => { patch(index, { from: event.target.value }) }} /></label>
                  <label className={css.field}><span className={css.label}>{t('routineTo')}</span><input className={css.nameInput} value={window.to} placeholder="12:00" onChange={(event) => { patch(index, { to: event.target.value }) }} /></label>
                  <label className={`${css.field} ${css.wide}`}><span className={css.label}>{t('routineActivity')}</span><input className={css.nameInput} value={window.activity} onChange={(event) => { patch(index, { activity: event.target.value }) }} /></label>
                  <div className={`${css.field} ${css.wide}`}>
                    <span className={css.label}>{t('routineDays')}</span>
                    <span>{DAYS.map(day => (
                      <label key={day}><input type="checkbox" checked={window.days.includes(day)} onChange={(event) => { patch(index, { days: event.target.checked ? [...window.days, day] : window.days.filter(entry => entry !== day) }) }} /> {t(`day_${day}`)} </label>
                    ))}</span>
                    <span className={css.help}>{t('routineDaysHelp')}</span>
                  </div>
                  <label className={`${css.field} ${css.wide}`}>
                    <span className={css.label}>{t('routineOn')}</span>
                    <input className={css.nameInput} value={(window.on ?? []).join(', ')} placeholder="dec, 12-24, season:winter, !holiday:festival" onChange={(event) => { const on = event.target.value.split(',').map(part => part.trim()).filter(part => part !== ''); const { on: _o, ...rest } = window; change(draft.map((item, at) => (at === index ? { ...rest, ...(on.length === 0 ? {} : { on }) } : item))) }} />
                    <span className={css.help}>{t('routineOnHelp')}</span>
                  </label>
                  <label className={css.field}>
                    <span className={css.label}>{t('routinePlace')}</span>
                    <select value={window.location ?? ''} onChange={(event) => { const { feature: _f, location: _l, ...rest } = window; change(draft.map((item, at) => (at === index ? { ...rest, ...optional(event.target.value) } : item))) }}>
                      <option value="">{t('routineNoPlace')}</option>
                      {world.places.map(entry => <option key={entry.key} value={entry.key}>{entry.name}</option>)}
                      {window.location !== undefined && place === undefined && <option value={window.location}>{window.location}</option>}
                    </select>
                  </label>
                  <label className={css.field}>
                    <span className={css.label}>{t('routineFeature')}</span>
                    <select value={window.feature ?? ''} disabled={place === undefined} onChange={(event) => { const { feature: _f, ...rest } = window; change(draft.map((item, at) => (at === index ? { ...rest, ...(event.target.value === '' ? {} : { feature: event.target.value }) } : item))) }}>
                      <option value="">{t('routineNoPlace')}</option>
                      {(place?.features ?? []).map(entry => <option key={entry.key} value={entry.key}>{entry.name}</option>)}
                    </select>
                  </label>
                  <label className={`${css.field} ${css.wide}`}><span className={css.label}>{t('routinePosition')}</span><input className={css.nameInput} value={window.position ?? ''} onChange={(event) => { const { position: _p, ...rest } = window; change(draft.map((item, at) => (at === index ? { ...rest, ...(event.target.value === '' ? {} : { position: event.target.value }) } : item))) }} /></label>
                  <label className={css.field}><span><input type="checkbox" checked={window.interruptible} onChange={(event) => { patch(index, { interruptible: event.target.checked }) }} /> {t('routineInterruptible')}</span></label>
                  <Button variant="ghost" size="sm" onClick={() => { change(draft.filter((_, at) => at !== index)) }}>{t('routineRemove')}</Button>
                </div>
              </section>
            )
          })}
          <Button variant="ghost" size="sm" onClick={() => { change([...draft, { ...BLANK }]) }}>{t('routineAdd')}</Button>
        </article>
      </div>
    </div>
  )
}
