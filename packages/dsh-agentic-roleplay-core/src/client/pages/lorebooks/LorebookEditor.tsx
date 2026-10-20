import { useEffect, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoreKind, LoreScope } from 'dsh-roleplay-model'
import type { LorebookEntry, LorebookSummary, LorebookText } from '../../../shared/lorebooks.ts'
import { readLorebook, removeLorebookEntry, updateLorebookInfo, writeLorebookEntry } from '../../lorebooks-api.ts'
import type { LorebooksPageProps } from './LorebooksPage.tsx'
import css from './LorebooksPage.module.css'

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
const KINDS = ['history', 'culture', 'religion', 'politics', 'geography', 'science', 'custom', 'legend', 'other'] as const satisfies readonly LoreKind[]
const SCOPES = ['everyone', 'listed'] as const satisfies readonly LoreScope[]
const ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u
const list = (text: string): string[] => text.split(/[,\n，、]/).map(entry => entry.trim()).filter(entry => entry !== '')

/** The entry as the form holds it: lists are text, so that they can be typed. */
interface Draft { id: string; title: string; kind: LoreKind; scope: LoreScope; knownBy: string; summary: string; body: string; related: string }
const draftOf = (entry: LorebookEntry): Draft => ({ id: entry.id, title: entry.title, kind: entry.kind, scope: entry.scope, knownBy: entry.knownBy.join(', '), summary: entry.summary, body: entry.body, related: entry.related.join(', ') })
const blank = (): Draft => ({ id: '', title: '', kind: 'other', scope: 'everyone', knownBy: '', summary: '', body: '', related: '' })
const entryOf = (draft: Draft): LorebookEntry => ({ id: draft.id.trim(), title: draft.title.trim(), kind: draft.kind, scope: draft.scope, knownBy: draft.scope === 'listed' ? list(draft.knownBy) : [], summary: draft.summary.trim(), body: draft.body, related: list(draft.related) })

interface Info { title: string; description: string }
const infoOf = (summary: LorebookSummary): Info => ({ title: summary.title === summary.name ? '' : summary.title, description: summary.description })
type Status = { state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }

/** One library lorebook: what it says about itself and its entries one at a time; the assistant does the larger rewrites and the import. */
export function LorebookEditor({ t, name, onBack, author }: { t: LorebooksPageProps['t']; name: string; onBack: () => void; author: () => void }) {
  const [loaded, setLoaded] = useState<LorebookText>()
  const [failure, setFailure] = useState<string>()
  const [info, setInfo] = useState<Info>()
  const [infoStatus, setInfoStatus] = useState<Status>({ state: 'idle' })
  const [draft, setDraft] = useState<Draft>(blank())
  const [creating, setCreating] = useState(true)
  const [entryStatus, setEntryStatus] = useState<Status>({ state: 'idle' })

  const accept = (value: LorebookText, keep?: string): void => {
    setLoaded(value)
    setInfo(infoOf(value.summary))
    const chosen = value.entries.find(entry => entry.id === keep) ?? value.entries[0]
    setCreating(chosen === undefined)
    setDraft(chosen === undefined ? blank() : draftOf(chosen))
  }

  useEffect(() => {
    const abort = new AbortController()
    readLorebook(name, abort.signal).then(value => { accept(value) }, (problem: unknown) => { if (!abort.signal.aborted) setFailure(messageOf(problem)) })
    return () => { abort.abort() }
  }, [name])

  if (loaded === undefined || info === undefined) return <p className={css.message} role={failure === undefined ? undefined : 'alert'}>{failure === undefined ? t('loading') : t('loadFailed', { message: failure })}</p>

  const saved = infoOf(loaded.summary)
  const infoDirty = JSON.stringify(info) !== JSON.stringify(saved)
  const current = creating ? undefined : loaded.entries.find(entry => entry.id === draft.id)
  const entryDirty = creating || (current !== undefined && JSON.stringify(draftOf(current)) !== JSON.stringify(draft))
  const ready = ID.test(draft.id.trim()) && draft.title.trim() !== '' && (draft.body.trim() !== '' || draft.summary.trim() !== '') && (draft.scope === 'everyone' || list(draft.knownBy).length > 0)

  const saveInfo = (): void => {
    setInfoStatus({ state: 'saving' })
    updateLorebookInfo(name, info, new AbortController().signal).then(
      (summary) => { setLoaded({ ...loaded, summary }); setInfo(infoOf(summary)); setInfoStatus({ state: 'saved' }) },
      (problem: unknown) => { setInfoStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const reload = (keep?: string): void => {
    readLorebook(name, new AbortController().signal).then(value => { accept(value, keep) }, (problem: unknown) => { setEntryStatus({ state: 'failed', message: messageOf(problem) }) })
  }
  const saveEntry = (): void => {
    setEntryStatus({ state: 'saving' })
    const entry = entryOf(draft)
    writeLorebookEntry(name, entry, new AbortController().signal).then(
      () => { setEntryStatus({ state: 'saved' }); reload(entry.id) },
      (problem: unknown) => { setEntryStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const removeEntry = (): void => {
    setEntryStatus({ state: 'saving' })
    removeLorebookEntry(name, draft.id, new AbortController().signal).then(
      () => { setEntryStatus({ state: 'idle' }); reload() },
      (problem: unknown) => { setEntryStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const edit = (change: Partial<Draft>): void => { setDraft({ ...draft, ...change }); setEntryStatus({ state: 'idle' }) }
  const text = (key: 'id' | 'title' | 'summary' | 'knownBy' | 'related', caption: Parameters<LorebooksPageProps['t']>[0], options: { disabled?: boolean } = {}) => (
    <label className={css.field}>
      <span className={css.label}>{t(caption)}</span>
      <input className={css.input} value={draft[key]} disabled={options.disabled === true} onChange={(event) => { edit({ [key]: event.target.value }) }} />
    </label>
  )

  return (
    <div className={css.page} data-testid="roleplay-lorebook-editor">
      <div className={css.editHeader}>
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular />} onClick={onBack}>{t('back')}</Button>
        <span className={css.editTitle}>{loaded.summary.title}</span>
        <Button variant="primary" size="sm" onClick={author}>{t('author')}</Button>
      </div>
      <div className={css.editBody}>
        {loaded.summary.problems.length > 0 && <p className={css.error} role="alert">{t('broken', { problems: loaded.summary.problems.join('; ') })}</p>}
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('info')}</h3>
          <label className={css.field}><span className={css.label}>{t('bookTitle')}</span><input className={css.input} value={info.title} onChange={(event) => { setInfo({ ...info, title: event.target.value }); setInfoStatus({ state: 'idle' }) }} /></label>
          <label className={css.field}><span className={css.label}>{t('bookDescription')}</span><textarea className={css.input} rows={3} value={info.description} onChange={(event) => { setInfo({ ...info, description: event.target.value }); setInfoStatus({ state: 'idle' }) }} /></label>
          <div className={css.actions}>
            <Button variant="primary" size="sm" disabled={!infoDirty || infoStatus.state === 'saving'} onClick={saveInfo}>{infoStatus.state === 'saving' ? t('infoSaving') : t('infoSave')}</Button>
            {infoStatus.state === 'saved' && <span className={css.ok} role="status">{t('infoSaved')}</span>}
            {infoStatus.state === 'failed' && <span className={css.error} role="alert">{t('infoFailed', { message: infoStatus.message ?? '' })}</span>}
          </div>
        </section>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('entries')}</h3>
          <p className={css.help}>{t('entriesHelp')}</p>
          <div className={css.actions}>
            {loaded.entries.length > 0 && (
              <select className={css.select} value={creating ? '' : draft.id} aria-label={t('entryPick')} data-testid="roleplay-lorebook-entry" onChange={(event) => { const found = loaded.entries.find(entry => entry.id === event.target.value); if (found !== undefined) { setCreating(false); setDraft(draftOf(found)); setEntryStatus({ state: 'idle' }) } }}>
                {creating && <option value="">{t('entryNew')}</option>}
                {loaded.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}{entry.scope === 'listed' ? ` · ${t('scope_listed')}` : ''}</option>)}
              </select>
            )}
            <Button variant="outline" size="sm" disabled={creating && draft.id === '' && draft.title === '' && draft.body === ''} onClick={() => { setCreating(true); setDraft(blank()); setEntryStatus({ state: 'idle' }) }}>{t('entryAdd')}</Button>
          </div>
          {text('id', 'entryId', { disabled: !creating })}
          {text('title', 'entryTitle')}
          <div className={css.row}>
            <label className={css.field}><span className={css.label}>{t('entryKind')}</span><select className={css.select} value={draft.kind} onChange={(event) => { edit({ kind: event.target.value as LoreKind }) }}>{KINDS.map(kind => <option key={kind} value={kind}>{t(`kind_${kind}`)}</option>)}</select></label>
            <label className={css.field}><span className={css.label}>{t('entryScope')}</span><select className={css.select} value={draft.scope} data-testid="roleplay-lorebook-scope" onChange={(event) => { edit({ scope: event.target.value as LoreScope }) }}>{SCOPES.map(scope => <option key={scope} value={scope}>{t(`scope_${scope}`)}</option>)}</select></label>
          </div>
          {draft.scope === 'listed' && text('knownBy', 'entryKnownBy')}
          {text('summary', 'entrySummary')}
          <label className={css.field}><span className={css.label}>{t('entryBody')}</span><textarea className={css.entryArea} value={draft.body} onChange={(event) => { edit({ body: event.target.value }) }} /></label>
          {loaded.entries.length > 1 && text('related', 'entryRelated')}
          <div className={css.actions}>
            <Button variant="primary" size="sm" disabled={!entryDirty || !ready || entryStatus.state === 'saving'} onClick={saveEntry}>{entryStatus.state === 'saving' ? t('entrySaving') : t('entrySave')}</Button>
            {!creating && <Button variant="ghost" size="sm" disabled={entryStatus.state === 'saving'} onClick={removeEntry}>{t('entryRemove')}</Button>}
            {entryStatus.state === 'saved' && <span className={css.ok} role="status">{t('entrySaved')}</span>}
            {entryStatus.state === 'failed' && <span className={css.error} role="alert">{t('entryFailed', { message: entryStatus.message ?? '' })}</span>}
          </div>
        </section>
      </div>
    </div>
  )
}
