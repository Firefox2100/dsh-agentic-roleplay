import { useEffect, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import type { CommandsDocument } from '../../shared/world-commands.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadCommands, saveCommands } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

interface CommandDraft { word: string; description: string }

const draftOf = (document: CommandsDocument): CommandDraft[] => document.commands.map(({ word, description }) => ({ word, description }))
const documentOf = (drafts: CommandDraft[]): CommandsDocument => ({ commands: drafts.map(({ word, description }) => ({ word: word.trim().replace(/^\//, ''), description: description.trim() })) })

/** The slash commands a world offers its player: each is a word and what it is for. */
export function CommandsPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [saved, setSaved] = useState<CommandDraft[]>()
  const [draft, setDraft] = useState<CommandDraft[]>([])
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const abort = new AbortController()
    loadCommands(worldId, abort.signal).then((value) => { const next = draftOf(value); setSaved(next); setDraft(next) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (saved === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>
  const dirty = JSON.stringify(documentOf(draft)) !== JSON.stringify(documentOf(saved))
  const change = (next: CommandDraft[]): void => { setDraft(next); setStatus({ state: 'idle' }) }
  const patch = (index: number, fields: Partial<CommandDraft>): void => { change(draft.map((entry, at) => (at === index ? { ...entry, ...fields } : entry))) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveCommands(worldId, documentOf(draft), new AbortController().signal).then(
      (value) => { const next = draftOf(value); setSaved(next); setDraft(next); setStatus({ state: 'saved' }) },
      (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }

  return (
    <div className={css.panel} data-testid="roleplay-commands-editor">
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
          <span className={css.help}>{t('commandsHelp')}</span>
          {draft.map((command, index) => (
            <section className={css.section} key={index} data-testid="roleplay-command">
              <div className={css.grid}>
                <label className={css.field}><span className={css.label}>{t('commandWord')}</span><input className={css.nameInput} value={command.word} onChange={(event) => { patch(index, { word: event.target.value }) }} /></label>
                <label className={`${css.field} ${css.wide}`}>
                  <span className={css.label}>{t('commandDescription')}</span>
                  <textarea className={css.nameInput} rows={2} value={command.description} onChange={(event) => { patch(index, { description: event.target.value }) }} />
                  <span className={css.help}>{t('commandDescriptionHelp')}</span>
                </label>
                <Button variant="ghost" size="sm" onClick={() => { change(draft.filter((_, other) => other !== index)) }}>{t('commandRemove')}</Button>
              </div>
            </section>
          ))}
          {draft.length === 0 && <p className={css.empty}>{t('commandsNone')}</p>}
          <Button variant="ghost" size="sm" onClick={() => { change([...draft, { word: '', description: '' }]) }}>{t('commandAdd')}</Button>
        </article>
      </div>
    </div>
  )
}
