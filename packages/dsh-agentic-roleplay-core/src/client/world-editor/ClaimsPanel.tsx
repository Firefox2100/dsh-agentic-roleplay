import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import { Tag } from '../ui/Tag.tsx'
import type { EditorClaim, EditorClaims } from '../../shared/claims.ts'
import type { Translate } from './WorldEditor.tsx'
import type { ClaimsApi } from './source.ts'
import css from './CharactersPanel.module.css'

const VERDICTS = ['true', 'false', 'likely', 'unlikely', 'open', 'disputed', 'unresolved', 'mixed'] as const
const BEARINGS = ['confirms', 'contradicts', 'supports', 'undermines'] as const
const isVerdict = (value: string): value is (typeof VERDICTS)[number] => (VERDICTS as readonly string[]).includes(value)
const isBearing = (value: string): value is (typeof BEARINGS)[number] => (BEARINGS as readonly string[]).includes(value)

/**
 * What people assert in a story and what the events say of each. A claim a keeper proposed waits here for a person to settle it or remove it; until then its
 * standing is the keeper's view and goes nowhere else.
 */
export function ClaimsPanel({ t, api, actions }: { t: Translate; api: ClaimsApi; actions: React.ReactNode }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; data: EditorClaims } | { status: 'failed'; message: string }>({ status: 'loading' })
  const [failure, setFailure] = useState<string>()
  const [removing, setRemoving] = useState<number>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    api.list(abort.signal).then(
      (data) => { setState({ status: 'ready', data }) },
      (error: unknown) => { if (!abort.signal.aborted) setState({ status: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { abort.abort() }
  }, [api])

  const act = useCallback((work: (signal: AbortSignal) => Promise<EditorClaims>): void => {
    setFailure(undefined)
    setBusy(true)
    work(new AbortController().signal).then(
      (data) => { setState({ status: 'ready', data }); setBusy(false) },
      (error: unknown) => { setFailure(t('cl_failed', { message: error instanceof Error ? error.message : String(error) })); setBusy(false) },
    )
  }, [t])

  if (state.status === 'loading') return <p className={css.message}>{t('editorLoading')}</p>
  if (state.status === 'failed') return <p className={css.error} role="alert">{t('editorLoadFailed', { message: state.message })}</p>
  const { claims, questions } = state.data
  const nameOf = (id: number): string => claims.find(claim => claim.id === id)?.text ?? String(id)
  const standing = (claim: EditorClaim): string => (isVerdict(claim.verdict) ? t(`cl_v_${claim.verdict}`) : claim.verdict)
  return (
    <div className={css.panel}>
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      <div className={css.body}>
        <article className={css.sheet}>
          <p>{t('cl_help')}</p>
          {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
          {claims.length === 0 && <p>{t('cl_none')}</p>}
          {claims.map(claim => (
            <section key={claim.id} className={css.section} data-testid={`roleplay-claim-${claim.id}`}>
              <h3 className={css.sectionTitle}>{claim.text} <Tag>{claim.status === 'proposed' ? t('cl_proposed') : t('cl_confirmed')}</Tag></h3>
              <p>{[claim.by === null ? undefined : t('cl_by', { name: claim.by }), claim.assertedIn === null ? t('cl_fromStart') : t('cl_madeIn', { text: claim.assertedIn.text })].filter(Boolean).join(' · ')}</p>
              <p><span className={css.label}>{t('cl_standing', { value: standing(claim) })}</span></p>
              {claim.parts.length > 0 && <ul>{claim.parts.map(part => <li key={part.key}>{part.text}</li>)}</ul>}
              <div>
                <span className={css.label}>{t('cl_evidence')}</span>
                {claim.links.length === 0
                  ? <p>{t('cl_noEvidence')}</p>
                  : <ul>{claim.links.map(link => <li key={`${link.event}-${link.part}`}><strong>{isBearing(link.as) ? t(`cl_b_${link.as}`) : link.as}</strong>: {link.text}</li>)}</ul>}
              </div>
              <p>
                {claim.status === 'proposed'
                  ? <Button size="sm" disabled={busy} onClick={() => { act(signal => api.setStatus(claim.id, 'confirmed', signal)) }}>{t('cl_confirm')}</Button>
                  : <Button variant="ghost" size="sm" disabled={busy} onClick={() => { act(signal => api.setStatus(claim.id, 'proposed', signal)) }}>{t('cl_putBack')}</Button>}{' '}
                {removing === claim.id
                  ? <><Button variant="primary" size="sm" disabled={busy} onClick={() => { setRemoving(undefined); act(signal => api.remove(claim.id, signal)) }}>{t('cl_removeConfirm')}</Button> <Button variant="ghost" size="sm" onClick={() => { setRemoving(undefined) }}>{t('cl_cancel')}</Button></>
                  : <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRemoving(claim.id) }}>{t('cl_remove')}</Button>}
              </p>
            </section>
          ))}
          {questions.length > 0 && (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('cl_questions')}</h3>
              <ul>{questions.map(question => <li key={question.id}>{question.text} — {t('cl_rivals', { list: question.rivals.map(nameOf).join(' / ') })}</li>)}</ul>
            </section>
          )}
        </article>
      </div>
    </div>
  )
}
