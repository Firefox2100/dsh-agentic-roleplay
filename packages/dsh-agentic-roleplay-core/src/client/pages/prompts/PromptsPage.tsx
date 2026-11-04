import { useEffect, useState } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptEntry } from '../../../shared/prompts.ts'
import type {} from '../../panel/slot-contract.ts'
import { PromptEditor } from './PromptEditor.tsx'
import type { PromptsFace } from './prompts-controller.ts'
import css from './PromptsPage.module.css'

export type PromptsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.prompts'>
  & InjectFace<PromptsFace>

const groupOf = (id: string): string => (id.includes('/') ? id.slice(0, id.indexOf('/')) : '')
const nameOf = (id: string): string => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id)

/** The prompts of the roleplay root: the instructions the models are given, with a sign on the ones that differ from what this version ships. */
export function PromptsPage({ t, usePrompts, load, refresh }: PromptsPageProps) {
  const state = usePrompts(snapshot => snapshot)
  const [editing, setEditing] = useState<{ id: string; language: string }>()
  const [onlyDifferent, setOnlyDifferent] = useState(false)
  const [language, setLanguage] = useState('')

  useEffect(() => { load() }, [load])

  if (editing !== undefined) return <PromptEditor t={t} id={editing.id} language={editing.language} onBack={() => { setEditing(undefined); refresh() }} />

  const entries = state.entries ?? []
  const languages = [...new Set(entries.map(entry => entry.language))].sort((a, b) => a.localeCompare(b))
  const shown = entries.filter(entry => (language === '' || entry.language === language) && (!onlyDifferent || entry.state === 'different'))
  const groups = [...new Set(shown.map(entry => groupOf(entry.id)))]
  const failedWithoutData = state.status === 'failed' && state.entries === undefined
  const row = (entry: PromptEntry) => (
    <li key={`${entry.language}/${entry.id}`}>
      <button type="button" className={css.row} data-testid="roleplay-prompt-row" onClick={() => { setEditing({ id: entry.id, language: entry.language }) }}>
        <span className={css.rowName}>{nameOf(entry.id)}</span>
        <span className={css.rowLanguage}>{entry.language}</span>
        <span className={css.sign} title={entry.state === 'different' ? t('differentHint') : undefined} aria-label={entry.state === 'different' ? t('differentHint') : undefined}>{entry.state === 'different' ? t('different') : ''}</span>
      </button>
    </li>
  )
  return (
    <div className={css.page} data-testid="roleplay-prompts-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.entries === undefined ? '' : t(shown.length === 1 ? 'countOne' : 'countOther', { count: shown.length })}</span>
        <select aria-label={t('language')} value={language} onChange={(event) => { setLanguage(event.target.value) }}>
          <option value="">{t('allLanguages')}</option>
          {languages.map(entry => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <label className={css.check}><input type="checkbox" checked={onlyDifferent} onChange={(event) => { setOnlyDifferent(event.target.checked) }} />{t('differentOnly')}</label>
        <span className={css.spacer} />
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={state.refreshing || state.status === 'loading'} aria-busy={state.refreshing} onClick={refresh}>{state.refreshing ? t('refreshing') : t('refresh')}</Button>
      </div>
      <p className={css.help}>{t('help')}</p>
      {state.error !== undefined && !failedWithoutData && <p className={css.error} role="alert">{t('loadFailed', { message: state.error })}</p>}
      <div className={css.viewport}>
        {state.status === 'idle' || state.status === 'loading'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.error} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : shown.length === 0
              ? <p className={css.message}>{t('empty')}</p>
              : groups.map(group => (
                <section key={group}>
                  <h3 className={css.group}>{group}</h3>
                  <ul className={css.list}>{shown.filter(entry => groupOf(entry.id) === group).map(row)}</ul>
                </section>
              ))}
      </div>
    </div>
  )
}
