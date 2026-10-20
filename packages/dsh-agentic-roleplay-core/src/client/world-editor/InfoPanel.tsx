import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorldInfo, WorldInfoEdit } from '../../shared/world-info.ts'
import type { Translate } from './WorldEditor.tsx'
import type { PresetSummary } from '../../shared/presets.ts'
import { listPresets } from '../presets-api.ts'
import { loadInfo, loadPlayable, saveInfo } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

interface Draft { name: string; description: string; tags: string; rules: string; opening: string; authorName: string; authorUrl: string; timeZone: string; startingTime: string; version: string; preset: string; alternates: { title: string; text: string; character?: string }[] }

const draftOf = (info: WorldInfo): Draft => ({ name: info.name, description: info.description, tags: info.tags.join(', '), rules: info.rules.join('\n'), opening: info.opening, authorName: info.authorName, authorUrl: info.authorUrl, timeZone: info.timeZone, startingTime: info.startingTime, version: info.version, preset: info.preset, alternates: info.alternateOpenings })
const lines = (value: string): string[] => value.split('\n').map(line => line.trim()).filter(line => line !== '')
const words = (value: string): string[] => value.split(/[,，]/).map(tag => tag.trim()).filter(tag => tag !== '')

/** The edit that turns the saved fields into the drafted ones: only what changed. */
function changes(saved: Draft, draft: Draft): WorldInfoEdit {
  const edit: Record<string, unknown> = {}
  for (const key of ['name', 'description', 'opening', 'authorName', 'authorUrl', 'timeZone', 'startingTime', 'version', 'preset'] as const) if (draft[key].trim() !== saved[key].trim()) edit[key] = draft[key]
  if (JSON.stringify(words(draft.tags)) !== JSON.stringify(words(saved.tags))) edit['tags'] = words(draft.tags)
  if (JSON.stringify(lines(draft.rules)) !== JSON.stringify(lines(saved.rules))) edit['rules'] = lines(draft.rules)
  const cleaned = (list: Draft['alternates']) => list.map(entry => ({ title: entry.title.trim(), text: entry.text.trim(), ...((entry.character ?? '') === '' ? {} : { character: entry.character }) })).filter(entry => entry.text !== '')
  if (JSON.stringify(cleaned(draft.alternates)) !== JSON.stringify(cleaned(saved.alternates))) edit['alternateOpenings'] = cleaned(draft.alternates)
  return edit as WorldInfoEdit
}

/** What the world says about itself: its name, description, tags, rules, opening, author and the start of its story clock. */
export function InfoPanel({ t, worldId, onSaved, actions }: { t: Translate; worldId: string; onSaved: () => void; actions: React.ReactNode }) {
  const [info, setInfo] = useState<WorldInfo>()
  const [saved, setSaved] = useState<Draft>()
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
  const [playable, setPlayable] = useState<{ id: string; name: string }[]>([])
  const [presets, setPresets] = useState<PresetSummary[]>([])
  useEffect(() => {
    const abort = new AbortController()
    listPresets(abort.signal).then(setPresets, () => undefined)
    return () => { abort.abort() }
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    loadPlayable(worldId, abort.signal).then(setPlayable, () => undefined)
    return () => { abort.abort() }
  }, [worldId])

  useEffect(() => {
    const abort = new AbortController()
    loadInfo(worldId, abort.signal).then((value) => { setInfo(value); setSaved(draftOf(value)); setDraft(draftOf(value)) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (info === undefined || saved === undefined || draft === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>

  const edit = changes(saved, draft)
  const dirty = Object.keys(edit).length > 0
  const set = (key: Exclude<keyof Draft, 'alternates'>, value: string): void => { setDraft({ ...draft, [key]: value }); setStatus({ state: 'idle' }) }
  const setAlternates = (alternates: Draft['alternates']): void => { setDraft({ ...draft, alternates }); setStatus({ state: 'idle' }) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveInfo(worldId, edit, new AbortController().signal).then((value) => { setInfo(value); setSaved(draftOf(value)); setDraft(draftOf(value)); setStatus({ state: 'saved' }); onSaved() }, (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
  }
  const field = (key: Exclude<keyof Draft, 'alternates'>, label: Parameters<Translate>[0], help?: Parameters<Translate>[0], options: { rows?: number; wide?: boolean; placeholder?: string; disabled?: boolean } = {}) => (
    <label className={`${css.field} ${options.wide === true || options.rows !== undefined ? css.wide : ''}`}>
      <span className={css.label}>{t(label)}</span>
      {options.rows === undefined
        ? <input className={css.nameInput} value={draft[key]} placeholder={options.placeholder} disabled={options.disabled} onChange={(event) => { set(key, event.target.value) }} />
        : <textarea className={css.area} rows={options.rows} value={draft[key]} disabled={options.disabled} onChange={(event) => { set(key, event.target.value) }} />}
      {help !== undefined && <span className={css.help}>{t(help)}</span>}
    </label>
  )
  return (
    <div className={css.panel} data-testid="roleplay-world-info">
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      {(dirty || status.state !== 'idle') && (
        <div className={css.bar} role="status">
          <span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>
          {dirty && <Button variant="ghost" size="sm" onClick={() => { setDraft(saved); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>}
          {dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving' || draft.name.trim() === ''} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}
        </div>
      )}
      <div className={css.body}>
        <article className={css.sheet}>
          <section className={css.section}>
            <div className={css.grid}>
              {field('name', 'name')}
              {field('tags', 'infoTags', 'infoTagsHelp')}
              {field('description', 'description', undefined, { rows: 5 })}
              {field('rules', 'infoRules', 'infoRulesHelp', { rows: 5 })}
              {field('opening', 'infoOpening', info.openingParts ? 'infoOpeningParts' : 'infoOpeningHelp', { rows: 8, disabled: info.openingParts })}
            </div>
          </section>
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('infoAlternates')}</h3>
            <span className={css.help}>{t('infoAlternatesHelp')}</span>
            {draft.alternates.map((entry, index) => (
              <div className={css.grid} key={index} data-testid="roleplay-alternate-opening">
                <label className={css.field}>
                  <span className={css.label}>{t('infoAlternateTitle')}</span>
                  <input className={css.nameInput} value={entry.title} onChange={(event) => { setAlternates(draft.alternates.map((item, at) => (at === index ? { ...item, title: event.target.value } : item))) }} />
                </label>
                <label className={`${css.field} ${css.wide}`}>
                  <span className={css.label}>{t('infoAlternateText')}</span>
                  <textarea className={css.area} rows={5} value={entry.text} onChange={(event) => { setAlternates(draft.alternates.map((item, at) => (at === index ? { ...item, text: event.target.value } : item))) }} />
                </label>
                <label className={css.field}>
                  <span className={css.label}>{t('infoAlternateFor')}</span>
                  <select className={css.select} value={entry.character ?? ''} onChange={(event) => { setAlternates(draft.alternates.map((item, at) => (at === index ? { ...item, character: event.target.value } : item))) }}>
                    <option value="">{t('infoAlternateAny')}</option>
                    {playable.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                    {entry.character !== undefined && entry.character !== '' && !playable.some(character => character.id === entry.character) && <option value={entry.character}>{entry.character}</option>}
                  </select>
                </label>
                <Button variant="ghost" size="sm" onClick={() => { setAlternates(draft.alternates.filter((_, at) => at !== index)) }}>{t('infoAlternateRemove')}</Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => { setAlternates([...draft.alternates, { title: '', text: '' }]) }}>{t('infoAlternateAdd')}</Button>
          </section>
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('infoStory')}</h3>
            <div className={css.grid}>
              {field('authorName', 'infoAuthor')}
              {field('version', 'infoVersion', 'infoVersionHelp', { placeholder: '1.0' })}
              {field('authorUrl', 'infoAuthorUrl', undefined, { placeholder: 'https://' })}
              {field('timeZone', 'infoTimeZone', 'infoTimeZoneHelp', { placeholder: 'Europe/London' })}
              {field('startingTime', 'infoStartingTime', 'infoStartingTimeHelp', { placeholder: '1912-04-14T23:40:00' })}
              <label className={css.field}>
                <span className={css.label}>{t('infoPreset')}</span>
                <select className={css.select} value={draft.preset} data-testid="roleplay-world-preset" onChange={(event) => { set('preset', event.target.value) }}>
                  <option value="">{t('infoPresetNone')}</option>
                  {presets.map(entry => <option key={entry.name} value={entry.name} disabled={entry.problems.length > 0}>{entry.title}</option>)}
                  {draft.preset !== '' && !presets.some(entry => entry.name === draft.preset) && <option value={draft.preset}>{t('infoPresetMissing', { name: draft.preset })}</option>}
                </select>
                <span className={css.help}>{t('infoPresetHelp')}</span>
              </label>
            </div>
          </section>
        </article>
      </div>
    </div>
  )
}
