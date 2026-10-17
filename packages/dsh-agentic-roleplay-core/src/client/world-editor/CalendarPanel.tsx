import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CalendarDocument } from '../../shared/world-daily.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadCalendar, saveCalendar } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

interface Draft { hemisphere: CalendarDocument['hemisphere']; holidays: { id: string; name: string; on: string }[] }

const draftOf = (calendar: CalendarDocument): Draft => ({ hemisphere: calendar.hemisphere, holidays: calendar.holidays.map(holiday => ({ id: holiday.id, name: holiday.name, on: holiday.on.join(', ') })) })
const documentOf = (draft: Draft): CalendarDocument => ({ hemisphere: draft.hemisphere, holidays: draft.holidays.map(holiday => ({ id: holiday.id.trim(), name: holiday.name.trim(), on: holiday.on.split(/[,，\n]/).map(day => day.trim()).filter(day => day !== '') })) })

/** The calendar of a world: which hemisphere its seasons follow, and its holidays, each told by the days it falls on. */
export function CalendarPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [saved, setSaved] = useState<Draft>()
  const [draft, setDraft] = useState<Draft>({ hemisphere: 'north', holidays: [] })
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const abort = new AbortController()
    loadCalendar(worldId, abort.signal).then((value) => { const next = draftOf(value); setSaved(next); setDraft(next) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (saved === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>
  const dirty = JSON.stringify(documentOf(draft)) !== JSON.stringify(documentOf(saved))
  const change = (next: Draft): void => { setDraft(next); setStatus({ state: 'idle' }) }
  const patch = (index: number, fields: Partial<Draft['holidays'][number]>): void => { change({ ...draft, holidays: draft.holidays.map((entry, at) => (at === index ? { ...entry, ...fields } : entry)) }) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveCalendar(worldId, documentOf(draft), new AbortController().signal).then(
      (value) => { const next = draftOf(value); setSaved(next); setDraft(next); setStatus({ state: 'saved' }) },
      (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }
  const field = (index: number, key: 'id' | 'name' | 'on', label: Parameters<Translate>[0], wide = false, placeholder?: string) => (
    <label className={`${css.field} ${wide ? css.wide : ''}`}><span className={css.label}>{t(label)}</span><input className={css.nameInput} value={draft.holidays[index]![key]} placeholder={placeholder} onChange={(event) => { patch(index, { [key]: event.target.value }) }} /></label>
  )

  return (
    <div className={css.panel} data-testid="roleplay-calendar">
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      {(dirty || status.state !== 'idle') && (
        <div className={css.bar} role="status">
          <span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>
          {dirty && <Button variant="ghost" size="sm" onClick={() => { setDraft(saved); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>}
          {dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving'} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}
        </div>
      )}
      <div className={css.body}>
        <article className={css.sheet}>
          <span className={css.help}>{t('calendarHelp')}</span>
          <section className={css.section}>
            <div className={css.grid}>
              <label className={css.field}>
                <span className={css.label}>{t('calendarHemisphere')}</span>
                <select value={draft.hemisphere} onChange={(event) => { change({ ...draft, hemisphere: event.target.value as Draft['hemisphere'] }) }}>
                  <option value="north">{t('hemisphereNorth')}</option>
                  <option value="south">{t('hemisphereSouth')}</option>
                </select>
              </label>
            </div>
          </section>
          {draft.holidays.map((_, index) => (
            <section className={css.section} key={index} data-testid="roleplay-holiday">
              <div className={css.grid}>
                {field(index, 'id', 'holidayId')}
                {field(index, 'name', 'holidayName')}
                {field(index, 'on', 'holidayOn', true, '09-21, nth:fri:last')}
                <Button variant="ghost" size="sm" onClick={() => { change({ ...draft, holidays: draft.holidays.filter((__, at) => at !== index) }) }}>{t('holidayRemove')}</Button>
              </div>
            </section>
          ))}
          {draft.holidays.length === 0 && <p className={css.empty}>{t('holidaysNone')}</p>}
          <Button variant="ghost" size="sm" onClick={() => { change({ ...draft, holidays: [...draft.holidays, { id: '', name: '', on: '' }] }) }}>{t('holidayAdd')}</Button>
        </article>
      </div>
    </div>
  )
}
