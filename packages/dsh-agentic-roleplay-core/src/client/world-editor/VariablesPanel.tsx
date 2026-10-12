import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { VARIABLE_KINDS, VARIABLE_SUBJECTS, VARIABLE_VISIBILITIES } from 'dsh-roleplay-model'
import { NEW, declarationOf, draftOf, type Draft } from './variables-draft.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadVariables, saveVariables } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

/** What the world tracks beyond what every story does: numbers, flags and choices about characters, things, places or the world, with how each is told. */
export function VariablesPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [saved, setSaved] = useState<Draft[]>()
  const [draft, setDraft] = useState<Draft[]>([])
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const abort = new AbortController()
    loadVariables(worldId, abort.signal).then((value) => { const drafts = value.map(draftOf); setSaved(drafts); setDraft(drafts) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (saved === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>
  const dirty = JSON.stringify(draft.map(declarationOf)) !== JSON.stringify(saved.map(declarationOf))
  const patch = (index: number, fields: Partial<Draft>): void => { setDraft(draft.map((entry, at) => (at === index ? { ...entry, ...fields } : entry))); setStatus({ state: 'idle' }) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveVariables(worldId, draft.map(declarationOf), new AbortController().signal).then((value) => { const drafts = value.map(draftOf); setSaved(drafts); setDraft(drafts); setStatus({ state: 'saved' }) }, (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
  }
  const text = (index: number, key: 'key' | 'name' | 'description' | 'min' | 'max' | 'default' | 'only' | 'options', label: Parameters<Translate>[0], wide = false) => (
    <label className={`${css.field} ${wide ? css.wide : ''}`}><span className={css.label}>{t(label)}</span><input className={css.nameInput} value={draft[index]![key]} onChange={(event) => { patch(index, { [key]: event.target.value }) }} /></label>
  )

  return (
    <div className={css.panel} data-testid="roleplay-variables">
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
          <span className={css.help}>{t('variablesHelp')}</span>
          {draft.map((entry, index) => (
            <section className={css.section} key={index} data-testid="roleplay-variable">
              <div className={css.grid}>
                {text(index, 'key', 'variableKey')}
                {text(index, 'name', 'name')}
                <label className={css.field}><span className={css.label}>{t('variableKind')}</span><select value={entry.kind} onChange={(event) => { patch(index, { kind: event.target.value as Draft['kind'] }) }}>{VARIABLE_KINDS.map(kind => <option key={kind} value={kind}>{t(`variableKind_${kind}`)}</option>)}</select></label>
                <label className={css.field}><span className={css.label}>{t('variableSubject')}</span><select value={entry.subject} onChange={(event) => { patch(index, { subject: event.target.value as Draft['subject'] }) }}>{VARIABLE_SUBJECTS.map(subject => <option key={subject} value={subject}>{t(`variableSubject_${subject}`)}</option>)}</select></label>
                <label className={css.field}><span className={css.label}>{t('variableVisibility')}</span><select value={entry.visibility} onChange={(event) => { patch(index, { visibility: event.target.value as Draft['visibility'] }) }}>{VARIABLE_VISIBILITIES.map(visibility => <option key={visibility} value={visibility}>{t(`variableVisibility_${visibility}`)}</option>)}</select></label>
                {text(index, 'description', 'description', true)}
                {entry.kind === 'number' && text(index, 'min', 'variableMin')}
                {entry.kind === 'number' && text(index, 'max', 'variableMax')}
                {text(index, 'default', 'variableDefault')}
                {entry.kind === 'choice' && text(index, 'options', 'variableOptions', true)}
                {entry.subject !== 'world' && text(index, 'only', 'variableOnly', true)}
                {entry.kind === 'number' && (
                  <label className={`${css.field} ${css.wide}`}><span className={css.label}>{t('variableBands')}</span><textarea className={css.area} rows={3} placeholder="3: low" value={entry.bands} onChange={(event) => { patch(index, { bands: event.target.value }) }} /><span className={css.help}>{t('variableBandsHelp')}</span></label>
                )}
                <div className={`${css.field} ${css.wide}`}>
                  <span>
                    {entry.kind === 'number' && <label><input type="checkbox" checked={entry.integer} onChange={(event) => { patch(index, { integer: event.target.checked }) }} /> {t('variableInteger')} </label>}
                    <label><input type="checkbox" checked={entry.baseline} onChange={(event) => { patch(index, { baseline: event.target.checked }) }} /> {t('variableBaseline')} </label>
                    <label><input type="checkbox" checked={entry.always} onChange={(event) => { patch(index, { always: event.target.checked }) }} /> {t('variableAlways')}</label>
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setDraft(draft.filter((_, at) => at !== index)); setStatus({ state: 'idle' }) }}>{t('variableRemove')}</Button>
              </div>
            </section>
          ))}
          {draft.length === 0 && <p className={css.empty}>{t('variablesNone')}</p>}
          <Button variant="ghost" size="sm" onClick={() => { setDraft([...draft, { ...NEW }]); setStatus({ state: 'idle' }) }}>{t('variableAdd')}</Button>
        </article>
      </div>
    </div>
  )
}
