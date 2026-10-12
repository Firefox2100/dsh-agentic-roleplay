import { useCallback, useEffect, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './WorldEditor.tsx'
import { loadPrompt, loadPrompts, removePrompt, savePrompt, type PromptEntry, type PromptText } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The prompts the models are given: the world can carry its own version of each, which replaces the shipped one in the sessions it starts. */
export function PromptsPanel({ t, worldId, language, actions }: { t: Translate; worldId: string; language: string; actions: React.ReactNode }) {
  const [tag, setTag] = useState(language)
  const [entries, setEntries] = useState<PromptEntry[]>()
  const [open, setOpen] = useState<string>()
  const [prompt, setPrompt] = useState<PromptText>()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  const list = useCallback(() => {
    loadPrompts(worldId, tag, new AbortController().signal).then(setEntries, (failure: unknown) => { setStatus({ state: 'failed', message: messageOf(failure) }) })
  }, [worldId, tag])
  useEffect(() => { list() }, [list])
  useEffect(() => {
    if (open === undefined) { setPrompt(undefined); return }
    const abort = new AbortController()
    loadPrompt(worldId, tag, open, abort.signal).then((value) => { setPrompt(value); setDraft(value.text); setStatus({ state: 'idle' }) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: messageOf(failure) }) })
    return () => { abort.abort() }
  }, [worldId, tag, open])

  const dirty = prompt !== undefined && draft !== prompt.text
  const write = (action: Promise<void>, done: () => void): void => {
    setStatus({ state: 'saving' })
    action.then(() => { setStatus({ state: 'saved' }); done(); list() }, (failure: unknown) => { setStatus({ state: 'failed', message: messageOf(failure) }) })
  }
  const reload = (): void => { const current = open; setOpen(undefined); setTimeout(() => { setOpen(current) }, 0) }
  return (
    <div className={css.panel} data-testid="roleplay-world-prompts">
      <div className={css.tabs}>
        <select className={css.select} value={tag} aria-label={t('promptsLanguage')} onChange={(event) => { setTag(event.target.value); setOpen(undefined) }}>
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
        <span className={css.tabsSpace} />{actions}
      </div>
      <div className={css.body}>
        <article className={css.sheet}>
          <p>{t('promptsHelp')}</p>
          <ul>
            {(entries ?? []).map(entry => (
              <li key={entry.id}>
                <Button variant="ghost" size="sm" onClick={() => { setOpen(entry.id === open ? undefined : entry.id) }}>{entry.id}</Button>{' '}
                <Tag>{t(entry.kind === 'prose' ? 'promptProse' : 'promptRules')}</Tag>{' '}{entry.carried && <Tag>{t('promptCarried')}</Tag>}
              </li>
            ))}
          </ul>
          {prompt !== undefined && open !== undefined && (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{open}</h3>
              <p className={css.help}>{t(prompt.carried ? 'promptOwnText' : 'promptShippedText')}</p>
              {(entries ?? []).find(entry => entry.id === open)?.kind === 'rules' && <p className={css.error}>{t('promptRulesWarning')}</p>}
              <textarea className={css.area} rows={18} aria-label={open} value={draft} onChange={(event) => { setDraft(event.target.value); setStatus({ state: 'idle' }) }} />
              <div className={css.row}>
                <Button variant="primary" size="sm" disabled={!dirty || draft.trim() === '' || status.state === 'saving'} onClick={() => { write(savePrompt(worldId, tag, open, draft, new AbortController().signal), reload) }}>{status.state === 'saving' ? t('saving') : t('save')}</Button>
                <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => { setDraft(prompt.text); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>
                {prompt.carried && <Button variant="ghost" size="sm" disabled={status.state === 'saving'} onClick={() => { write(removePrompt(worldId, tag, open, new AbortController().signal), reload) }}>{t('promptRevert')}</Button>}
                {status.state === 'failed' && <span className={css.error} role="alert">{t('saveFailed', { message: status.message ?? '' })}</span>}
                {status.state === 'saved' && <span className={css.barText}>{t('saved')}</span>}
              </div>
            </section>
          )}
        </article>
      </div>
    </div>
  )
}
