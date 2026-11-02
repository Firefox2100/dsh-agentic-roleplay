import { useEffect, useRef, useState, type ReactNode } from 'react'
import { roleplaySessionOf } from '../../../shared/chat.ts'
import { MAX_JOURNAL } from '../../../shared/journal.ts'
import { loadJournal, saveJournal } from '../reference-api.ts'
import type { SectionProps } from './sections.tsx'
import css from './Page.module.css'

/** How long typing pauses before the notes are saved. */
const SAVE_AFTER_MS = 1000

type Saving = 'saved' | 'unsaved' | 'saving' | { failed: string }

/** The player's own notes: written here, kept with the story, never read by the story. */
export function JournalPage({ t, sessionId, visible }: SectionProps): ReactNode {
  const session = roleplaySessionOf(sessionId)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState<Saving>('saved')
  const [error, setError] = useState<string>()
  const pending = useRef<{ session: string; text: string; timer: number } | undefined>(undefined)
  const currentSession = useRef(session)
  const saveSequence = useRef(0)

  const flush = (): void => {
    const waiting = pending.current
    if (waiting === undefined) return
    window.clearTimeout(waiting.timer)
    pending.current = undefined
    setSaving('saving')
    const sequence = ++saveSequence.current
    saveJournal(waiting.session, waiting.text).then(
      () => { if (sequence === saveSequence.current) setSaving(pending.current === undefined ? 'saved' : 'unsaved') },
      (failure: unknown) => { if (sequence === saveSequence.current) setSaving({ failed: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    if (currentSession.current === session) return
    flushRef.current()
    saveSequence.current += 1
    currentSession.current = session
    setText('')
    setLoaded(false)
    setSaving('saved')
    setError(undefined)
  }, [session])

  useEffect(() => {
    if (session === undefined || !visible || loaded) return undefined
    const abort = new AbortController()
    loadJournal(session, abort.signal).then(
      (journal) => { setText(journal.text); setLoaded(true) },
      (failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => { abort.abort() }
  }, [session, visible, loaded])
  useEffect(() => () => { flushRef.current() }, [])

  if (error !== undefined) return <p className={css.message} role="alert">{t('failed', { message: error })}</p>
  if (!loaded) return <p className={css.message}>{t('loading')}</p>
  const edit = (value: string): void => {
    setText(value)
    setSaving('unsaved')
    if (pending.current !== undefined) window.clearTimeout(pending.current.timer)
    if (session !== undefined) pending.current = { session, text: value, timer: window.setTimeout(flush, SAVE_AFTER_MS) }
  }
  return (
    <div className={css.journal}>
      <textarea className={css.notes} value={text} maxLength={MAX_JOURNAL} placeholder={t('journalHint')} aria-label={t('journal')} onChange={(event) => { edit(event.target.value) }} onBlur={flush} />
      <p className={css.meta} role="status">{typeof saving === 'object' ? t('saveFailed', { message: saving.failed }) : t(saving === 'saved' ? 'savedNotes' : saving === 'saving' ? 'savingNotes' : 'unsavedNotes')}</p>
    </div>
  )
}
