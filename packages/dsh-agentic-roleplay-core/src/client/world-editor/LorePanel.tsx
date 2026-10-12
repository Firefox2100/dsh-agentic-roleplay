import { useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { LORE_KINDS } from 'dsh-roleplay-model'
import type { LoreEdit, WorldLore, WorldState } from '../../shared/world-state.ts'
import type { Translate } from './WorldEditor.tsx'
import type { WorldSource } from './source.ts'
import css from './CharactersPanel.module.css'

type Draft = Pick<WorldLore, 'title' | 'kind' | 'summary' | 'body'> & { sources: string }

export function LorePanel({ t, world: rawWorld, source, onChanged, actions }: { t: Translate; world: WorldState; source: WorldSource; onChanged: (world: WorldState) => void; actions: React.ReactNode }) {
  const world = { ...rawWorld, lore: rawWorld.lore ?? [] }
  const [chosen, setChosen] = useState<string>(); const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
  const lore = world.lore.find(entry => entry.key === chosen) ?? world.lore[0]
  const [title, setTitle] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const [refused, setRefused] = useState<string>()
  const run = (action: Promise<WorldState>, then?: () => void): void => {
    setRefused(undefined)
    action.then((next) => { then?.(); onChanged(next) }, (failure: unknown) => { setRefused(failure instanceof Error ? failure.message : String(failure)) })
  }
  const add = (): void => {
    if (source.addLore === undefined || title === undefined || title.trim() === '') return
    run(source.addLore(title.trim(), new AbortController().signal), () => { setTitle(undefined); setChosen(undefined); setConfirming(false) })
  }
  const manage = source.addLore === undefined ? null : (
    <span className={css.barText} data-testid="roleplay-lore-manage">
      {title === undefined
        ? <Button variant="ghost" size="sm" onClick={() => { setTitle('') }}>{t('loreAdd')}</Button>
        : <><Input value={title} aria-label={t('loreTitle')} onChange={event => { setTitle(event.target.value) }} /><Button variant="primary" size="sm" disabled={title.trim() === ''} onClick={add}>{t('loreAddConfirm')}</Button><Button variant="ghost" size="sm" onClick={() => { setTitle(undefined) }}>{t('reset')}</Button></>}
      {world.lore.length > 0 && source.removeLore !== undefined && (confirming
        ? <><Button variant="primary" size="sm" onClick={() => { const key = (world.lore.find(entry => entry.key === chosen) ?? world.lore[0])!.key; run(source.removeLore!(key, new AbortController().signal), () => { setConfirming(false); setChosen(undefined) }) }}>{t('loreRemoveConfirm')}</Button><Button variant="ghost" size="sm" onClick={() => { setConfirming(false) }}>{t('reset')}</Button></>
        : <Button variant="ghost" size="sm" onClick={() => { setConfirming(true) }}>{t('loreRemove')}</Button>)}
      {refused !== undefined && <span className={css.error} role="alert">{refused}</span>}
    </span>
  )
  if (lore === undefined) return <div className={css.panel}><div className={css.tabs}>{manage}<span className={css.tabsSpace} />{actions}</div><p className={css.empty}>{t('noLore')}</p></div>
  const original: Draft = { title: lore.title, kind: lore.kind, summary: lore.summary, body: lore.body, sources: lore.sources.join('\n') }; const draft = drafts[lore.key] ?? original; const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const change = (next: Draft): void => { setDrafts({ ...drafts, [lore.key]: next }); setStatus({ state: 'idle' }) }
  const save = (): void => { const edit: LoreEdit = { title: draft.title, kind: draft.kind, summary: draft.summary, body: draft.body, sources: draft.sources.split('\n').map(x => x.trim()).filter(Boolean) }; setStatus({ state: 'saving' }); source.saveLore(lore.key, edit, new AbortController().signal).then(next => { setDrafts(({ [lore.key]: _, ...rest }) => rest); setStatus({ state: 'saved' }); onChanged(next) }, failure => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) }) }
  return <div className={css.panel}><div className={css.tabs} role="tablist">{world.lore.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={entry.key === lore.key} className={`${css.tab} ${entry.key === lore.key ? css.tabOn : ''}`} onClick={() => { setChosen(entry.key); setStatus({ state: 'idle' }) }}>{entry.title}</button>)}{manage}<span className={css.tabsSpace} />{actions}</div>{(dirty || status.state !== 'idle') && <div className={css.bar} role="status"><span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>{dirty && <Button variant="ghost" size="sm" onClick={() => { setDrafts(({ [lore.key]: _, ...rest }) => rest); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>}{dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving'} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}</div>}<div className={css.body}><article className={css.sheet}><Input value={draft.title} aria-label={t('loreTitle')} onChange={event => { change({ ...draft, title: event.target.value }) }} /><label className={css.field}><span className={css.label}>{t('kind')}</span><select value={draft.kind} onChange={event => { change({ ...draft, kind: event.target.value as WorldLore['kind'] }) }}>{LORE_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label><section className={css.section}><h3 className={css.sectionTitle}>{t('summary')}</h3><textarea className={css.area} rows={2} value={draft.summary} onChange={event => { change({ ...draft, summary: event.target.value }) }} /></section><section className={css.section}><h3 className={css.sectionTitle}>{t('loreBody')}</h3><textarea className={css.area} rows={10} value={draft.body} onChange={event => { change({ ...draft, body: event.target.value }) }} /></section><section className={css.section}><h3 className={css.sectionTitle}>{t('subjects')}</h3>{lore.subjects.map(subject => <Tag key={`${subject.kind}:${subject.key}`}>{subject.kind}: {subject.name}</Tag>)}</section><section className={css.section}><h3 className={css.sectionTitle}>{t('relatedLore')}</h3>{lore.related.map(entry => <div key={entry.key}>{entry.title}</div>)}</section><section className={css.section}><h3 className={css.sectionTitle}>{t('sources')}</h3><textarea className={css.area} rows={3} value={draft.sources} onChange={event => { change({ ...draft, sources: event.target.value }) }} /></section></article></div></div>
}
