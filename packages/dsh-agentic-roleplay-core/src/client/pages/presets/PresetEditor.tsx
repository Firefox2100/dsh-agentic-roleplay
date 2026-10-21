import { useEffect, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresetSummary } from '../../../shared/presets.ts'
import { listRulesPrompts, readPreset, readPresetPrompt, removePresetPrompt, updatePresetInfo, writePresetPrompt, type PresetText } from '../../presets-api.ts'
import { SamplingFields, samplingOfTexts, samplingTexts, type SamplingTexts } from '../../widgets/sampling-fields/SamplingFields.tsx'
import type { PresetsPageProps } from './PresetsPage.tsx'
import css from './PresetsPage.module.css'

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
const PROMPT_IDS = ['roleplay/persona', 'roleplay/style', 'roleplay/character-style'] as const
const PROMPT_LANGUAGES = ['en', 'zh'] as const
const promptKey = (path: string): { language: string; id: string } => ({ language: path.slice(0, path.indexOf('/')), id: path.slice(path.indexOf('/') + 1) })

interface Info { title: string; description: string; sampling: SamplingTexts }
const infoOf = (summary: PresetSummary): Info => ({ title: summary.title === summary.name ? '' : summary.title, description: summary.description, sampling: samplingTexts(summary.sampling) })

/** One library preset: what it says about itself and the text of each prompt it carries; the assistant does the larger rewrites. */
export function PresetEditor({ t, name, onBack, author }: { t: PresetsPageProps['t']; name: string; onBack: () => void; author: () => void }) {
  const [loaded, setLoaded] = useState<PresetText>()
  const [failure, setFailure] = useState<string>()
  const [info, setInfo] = useState<Info>()
  const [infoStatus, setInfoStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState('')
  const [addition, setAddition] = useState('')
  const [rulesOffered, setRulesOffered] = useState<string[]>([])
  const [rulesChoice, setRulesChoice] = useState('')
  const [promptStatus, setPromptStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  const accept = (value: PresetText, keep?: string): void => {
    setLoaded(value)
    setInfo(infoOf(value.summary))
    setDraft('')
    const paths = Object.keys(value.prompts).sort((a, b) => a.localeCompare(b))
    const chosen = keep !== undefined && paths.includes(keep) ? keep : paths[0] ?? ''
    setPath(chosen)
    setText(value.prompts[chosen] ?? '')
  }

  useEffect(() => {
    const abort = new AbortController()
    readPreset(name, abort.signal).then(value => { accept(value) }, (problem: unknown) => { if (!abort.signal.aborted) setFailure(messageOf(problem)) })
    return () => { abort.abort() }
  }, [name])

  useEffect(() => {
    const abort = new AbortController()
    Promise.all(PROMPT_LANGUAGES.map(async language => (await listRulesPrompts(name, language, abort.signal)).map(id => `${language}/${id}`))).then(
      (lists) => { setRulesOffered(lists.flat()) },
      (problem: unknown) => { if (!abort.signal.aborted) setFailure(messageOf(problem)) },
    )
    return () => { abort.abort() }
  }, [name, loaded?.summary.rules.length, Object.keys(loaded?.prompts ?? {}).length])

  if (loaded === undefined || info === undefined) return <p className={css.message} role={failure === undefined ? undefined : 'alert'}>{failure === undefined ? t('loading') : t('loadFailed', { message: failure })}</p>

  const paths = [...Object.keys(loaded.prompts), ...(draft === '' ? [] : [draft])].sort((a, b) => a.localeCompare(b))
  const missing = PROMPT_LANGUAGES.flatMap(language => PROMPT_IDS.map(id => `${language}/${id}`)).filter(key => !paths.includes(key))
  const saved = infoOf(loaded.summary)
  const infoDirty = JSON.stringify(info) !== JSON.stringify(saved)
  const promptDirty = path !== '' && (path === draft || text !== loaded.prompts[path])
  const saveInfo = (): void => {
    setInfoStatus({ state: 'saving' })
    updatePresetInfo(name, { title: info.title, description: info.description, sampling: samplingOfTexts(info.sampling) }, new AbortController().signal).then(
      (summary) => { setLoaded({ ...loaded, summary }); setInfo(infoOf(summary)); setInfoStatus({ state: 'saved' }) },
      (problem: unknown) => { setInfoStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const afterPrompt = (summary: PresetSummary, prompts: Record<string, string>, keep?: string): void => {
    accept({ summary, prompts }, keep)
  }
  const savePrompt = (): void => {
    const { language, id } = promptKey(path)
    setPromptStatus({ state: 'saving' })
    writePresetPrompt(name, language, id, text, new AbortController().signal).then(
      (summary) => { afterPrompt(summary, { ...loaded.prompts, [path]: text.endsWith('\n') ? text : `${text}\n` }, path); setPromptStatus({ state: 'saved' }) },
      (problem: unknown) => { setPromptStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const removePrompt = (): void => {
    if (path === draft) { setDraft(''); const rest = Object.keys(loaded.prompts).sort((a, b) => a.localeCompare(b)); setPath(rest[0] ?? ''); setText(loaded.prompts[rest[0] ?? ''] ?? ''); setPromptStatus({ state: 'idle' }); return }
    const { language, id } = promptKey(path)
    setPromptStatus({ state: 'saving' })
    removePresetPrompt(name, language, id, new AbortController().signal).then(
      (summary) => { const rest = { ...loaded.prompts }; delete rest[path]; afterPrompt(summary, rest); setPromptStatus({ state: 'idle' }) },
      (problem: unknown) => { setPromptStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }
  const isRules = (key: string): boolean => key !== '' && !(PROMPT_IDS as readonly string[]).includes(promptKey(key).id)
  const label = (key: string): string => { const { language, id } = promptKey(key); return `${language} · ${(PROMPT_IDS as readonly string[]).includes(id) ? t(`prompt_${id}` as 'prompt_roleplay/style') : id}` }
  const field = (key: 'title' | 'description', caption: Parameters<PresetsPageProps['t']>[0], options: { rows?: number } = {}) => (
    <label className={css.field}>
      <span className={css.label}>{t(caption)}</span>
      {options.rows === undefined
        ? <input className={css.input} value={info[key]} onChange={(event) => { setInfo({ ...info, [key]: event.target.value }); setInfoStatus({ state: 'idle' }) }} />
        : <textarea className={css.input} rows={options.rows} value={info[key]} onChange={(event) => { setInfo({ ...info, [key]: event.target.value }); setInfoStatus({ state: 'idle' }) }} />}
    </label>
  )

  return (
    <div className={css.page} data-testid="roleplay-preset-editor">
      <div className={css.editHeader}>
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular />} onClick={onBack}>{t('back')}</Button>
        <span className={css.editTitle}>{loaded.summary.title}</span>
        <Button variant="primary" size="sm" onClick={author}>{t('author')}</Button>
      </div>
      <div className={css.editBody}>
        {loaded.summary.problems.length > 0 && <p className={css.error} role="alert">{t('broken', { problems: loaded.summary.problems.join('; ') })}</p>}
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('info')}</h3>
          {field('title', 'presetTitle')}
          {field('description', 'presetDescription', { rows: 3 })}
          <SamplingFields texts={info.sampling} t={t} onChange={(sampling) => { setInfo({ ...info, sampling }); setInfoStatus({ state: 'idle' }) }} />
          <div className={css.actions}>
            <Button variant="primary" size="sm" disabled={!infoDirty || infoStatus.state === 'saving'} onClick={saveInfo}>{infoStatus.state === 'saving' ? t('infoSaving') : t('infoSave')}</Button>
            {infoStatus.state === 'saved' && <span className={css.ok} role="status">{t('infoSaved')}</span>}
            {infoStatus.state === 'failed' && <span className={css.error} role="alert">{t('infoFailed', { message: infoStatus.message ?? '' })}</span>}
          </div>
        </section>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('prompts')}</h3>
          <p className={css.help}>{t('promptsHelp')}</p>
          {loaded.summary.rules.length > 0 && <p className={css.warning} role='note'>{t('rulesWarning', { list: loaded.summary.rules.join(', ') })}</p>}
          {paths.length === 0 && <p className={css.message}>{t('promptsNone')}</p>}
          {paths.length > 0 && (
              <>
                <label className={css.field}>
                  <span className={css.label}>{t('promptPick')}</span>
                  <select value={path} data-testid="roleplay-preset-prompt" onChange={(event) => { setPath(event.target.value); setText(loaded.prompts[event.target.value] ?? ''); setPromptStatus({ state: 'idle' }) }}>
                    {paths.map(key => <option key={key} value={key}>{label(key)}</option>)}
                  </select>
                </label>
                <textarea className={css.area} value={text} aria-label={t('promptPick')} onChange={(event) => { setText(event.target.value); setPromptStatus({ state: 'idle' }) }} />
                <div className={css.actions}>
                  <Button variant="primary" size="sm" disabled={!promptDirty || promptStatus.state === 'saving' || text.trim() === ''} onClick={savePrompt}>{promptStatus.state === 'saving' ? t('promptSaving') : t('promptSave')}</Button>
                  <Button variant="ghost" size="sm" disabled={!promptDirty} onClick={() => { setText(loaded.prompts[path] ?? '') }}>{t('promptReset')}</Button>
                  <Button variant="ghost" size="sm" disabled={promptStatus.state === 'saving'} onClick={removePrompt}>{t('promptRemove')}</Button>
                  {promptStatus.state === 'saved' && <span className={css.ok} role="status">{t('promptSaved')}</span>}
                  {promptStatus.state === 'failed' && <span className={css.error} role="alert">{t('promptFailed', { message: promptStatus.message ?? '' })}</span>}
                </div>
              </>
            )}
          {rulesOffered.filter(key => !paths.includes(key)).length > 0 && (
            <div className={css.actions}>
              <select value={rulesChoice} aria-label={t('rulesAdd')} data-testid="roleplay-preset-rules-add" onChange={(event) => { setRulesChoice(event.target.value) }}>
                <option value="">{t('rulesAdd')}</option>
                {rulesOffered.filter(key => !paths.includes(key)).map(key => <option key={key} value={key}>{label(key)}</option>)}
              </select>
              <Button variant="ghost" size="sm" disabled={rulesChoice === ''} onClick={() => {
                const { language, id } = promptKey(rulesChoice)
                readPresetPrompt(name, language, id, new AbortController().signal).then(
                  (shipped) => { setDraft(rulesChoice); setPath(rulesChoice); setText(shipped); setRulesChoice(''); setPromptStatus({ state: 'idle' }) },
                  (problem: unknown) => { setPromptStatus({ state: 'failed', message: messageOf(problem) }) },
                )
              }}>{t('promptAddButton')}</Button>
            </div>
          )}
          {isRules(path) && <p className={css.warning} role="note">{t('rulesWarning', { list: promptKey(path).id })}</p>}
          {missing.length > 0 && (
            <div className={css.actions}>
              <select value={addition} aria-label={t('promptAdd')} data-testid="roleplay-preset-prompt-add" onChange={(event) => { setAddition(event.target.value) }}>
                <option value="">{t('promptAdd')}</option>
                {missing.map(key => <option key={key} value={key}>{label(key)}</option>)}
              </select>
              <Button variant="ghost" size="sm" disabled={addition === ''} onClick={() => { setDraft(addition); setPath(addition); setText(''); setAddition(''); setPromptStatus({ state: 'idle' }) }}>{t('promptAddButton')}</Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
