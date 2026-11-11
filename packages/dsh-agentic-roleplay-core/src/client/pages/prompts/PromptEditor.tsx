import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal.tsx'
import { Button } from '../../ui/Button.tsx'
import type { PromptDetail } from '../../../shared/prompts.ts'
import { readPrompt, resetPrompt, savePrompt } from '../../prompts-api.ts'
import { compareLines } from './prompt-diff.ts'
import type { PromptsPageProps } from './PromptsPage.tsx'
import css from './PromptsPage.module.css'
import { IconChevronLeft } from '../../ui/icons.tsx'


const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
const PROSE = ['roleplay/persona', 'roleplay/style', 'roleplay/character-style']
const same = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd()

/** One prompt: the person's file beside the text this version ships, which can be read to bring something new into the file, or replace it after a confirmation. */
export function PromptEditor({ t, id, language, onBack }: { t: PromptsPageProps['t']; id: string; language: string; onBack: () => void }) {
  const [loaded, setLoaded] = useState<PromptDetail>()
  const [failure, setFailure] = useState<string>()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
  const [confirming, setConfirming] = useState(false)

  const accept = (detail: PromptDetail): void => { setLoaded(detail); setText(detail.current) }

  useEffect(() => {
    const abort = new AbortController()
    readPrompt(id, language, abort.signal).then(accept, (problem: unknown) => { if (!abort.signal.aborted) setFailure(messageOf(problem)) })
    return () => { abort.abort() }
  }, [id, language])

  const area = useRef<HTMLTextAreaElement>(null)
  // Keep both comparison panes aligned without trapping the editor in a nested scrollbar.
  useLayoutEffect(() => {
    const box = area.current
    if (box === null) return
    box.style.height = '0px'
    box.style.height = `${box.scrollHeight + 2}px`
  }, [text, loaded])

  const comparison = useMemo(() => (loaded === undefined ? undefined : compareLines(loaded.shipped, text)), [loaded, text])

  if (loaded === undefined || comparison === undefined) return <p className={css.message} role={failure === undefined ? undefined : 'alert'}>{failure === undefined ? t('loading') : t('loadFailed', { message: failure })}</p>

  const dirty = !same(text, loaded.current)
  const identical = same(text, loaded.shipped)
  const save = (): void => {
    setStatus({ state: 'saving' })
    savePrompt(id, language, text, new AbortController().signal).then(
      () => { setLoaded({ ...loaded, current: text, state: identical ? 'default' : 'different' }); setStatus({ state: 'saved' }) },
      (problem: unknown) => { setStatus({ state: 'failed', message: messageOf(problem) }) },
    )
  }

  return (
    <div className={css.page} data-testid="roleplay-prompt-editor">
      <div className={css.editHeader}>
        <Button variant="ghost" size="sm" icon={<IconChevronLeft />} onClick={onBack}>{t('back')}</Button>
        <span className={css.editTitle}>{id} · {language}{loaded.state === 'different' ? ` ${t('different')}` : ''}</span>
        {dirty && <span className={css.warning}>{t('unsaved')}</span>}
      </div>
      <div className={css.editBody}>
        <p className={css.help}>{loaded.variables.length === 0 ? t('noVariables') : t('variables', { list: loaded.variables.map(name => `\${${name}}`).join(', ') })}</p>
        {!PROSE.includes(id) && <p className={css.warning} role="note">{t('rulesWarning')}</p>}
        <p className={css.help}>{identical ? t('sameAsShipped') : t('comparison', { missing: comparison.shipped.filter(line => line.missing).length, extra: comparison.extra })}</p>
        <div className={css.panes}>
          <div className={css.pane}>
            <span className={css.label}>{t('yours')}</span>
            <textarea ref={area} className={css.area} value={text} aria-label={t('yours')} data-testid="roleplay-prompt-text" onChange={(event) => { setText(event.target.value); setStatus({ state: 'idle' }) }} />
          </div>
          <div className={css.pane}>
            <span className={css.label}>{t('shippedText')}</span>
            <pre className={css.shipped} aria-label={t('shippedText')} data-testid="roleplay-prompt-shipped">{comparison.shipped.map((line, index) => <span key={index} className={line.missing ? `${css.line} ${css.missing}` : css.line}>{line.text}</span>)}</pre>
            <p className={css.help}>{t('shippedHelp')}</p>
          </div>
        </div>
        <div className={css.actions}>
          <Button variant="primary" size="sm" disabled={!dirty || status.state === 'saving' || text.trim() === ''} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>
          <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => { setText(loaded.current); setStatus({ state: 'idle' }) }}>{t('undo')}</Button>
          <Button variant="outline" size="sm" disabled={same(loaded.current, loaded.shipped)} onClick={() => { setConfirming(true) }}>{t('replace')}</Button>
          {status.state === 'saved' && <span className={css.ok} role="status">{t('saved')}</span>}
          {status.state === 'failed' && <span className={css.error} role="alert">{t('saveFailed', { message: status.message ?? '' })}</span>}
        </div>
      </div>
      {confirming && <ReplaceDialog t={t} id={id} language={language} onClose={() => { setConfirming(false) }} onReplaced={() => { setConfirming(false); setLoaded({ ...loaded, current: loaded.shipped, state: 'default' }); setText(loaded.shipped); setStatus({ state: 'idle' }) }} />}
    </div>
  )
}

function ReplaceDialog({ t, id, language, onClose, onReplaced }: { t: PromptsPageProps['t']; id: string; language: string; onClose: () => void; onReplaced: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const confirm = (): void => {
    setBusy(true); setError(undefined)
    resetPrompt(id, language, new AbortController().signal).then(onReplaced, (problem: unknown) => { setBusy(false); setError(messageOf(problem)) })
  }
  return (
    <Modal open onClose={onClose} title={t('replaceTitle')} description={t('replaceHelp', { name: id, language })} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" disabled={busy} data-testid="roleplay-prompt-replace" onClick={confirm}>{busy ? t('replacing') : t('replace')}</Button></>}>
      {error !== undefined && <p className={css.error} role="alert">{t('replaceFailed', { message: error })}</p>}
    </Modal>
  )
}
