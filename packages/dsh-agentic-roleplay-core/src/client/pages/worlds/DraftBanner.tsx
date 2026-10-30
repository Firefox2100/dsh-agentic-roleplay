import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { decideDraft, draftStatus, type DraftStatus } from './import-api.ts'
import css from './TranslateBanner.module.css'

/** The most problems the banner lists: the rest are counted. */
const SHOWN = 5

/** Says that a world is an import written as a draft, what is wrong with it, and lets the person have it repaired, keep it as it is or discard it. */
export function DraftBanner({ t, worldId, version, openChat, onChanged, onDiscarded }: { t: TranslateNS<'roleplay.worlds'>; worldId: string; version: number; openChat: (chatSessionId: string) => void; onChanged: () => void; onDiscarded: () => void }) {
  const [status, setStatus] = useState<DraftStatus>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string>()
  useEffect(() => {
    const abort = new AbortController()
    setStatus(undefined)
    setFailure(undefined)
    draftStatus(worldId, abort.signal).then(
      setStatus,
      (error: unknown) => { if (!abort.signal.aborted) setFailure(t('draftFailed', { message: error instanceof Error ? error.message : String(error) })) },
    )
    return () => { abort.abort() }
  }, [worldId, version])
  if (status?.draft !== true) return failure === undefined ? null : <p className={css.error} role="alert">{failure}</p>
  const decide = (action: 'ask' | 'keep' | 'discard'): void => {
    setBusy(true)
    setFailure(undefined)
    decideDraft(worldId, action, t('language')).then(
      (done) => {
        setBusy(false)
        setConfirming(false)
        if (action === 'discard') onDiscarded()
        else onChanged()
        if (action === 'ask' && done.started !== undefined) openChat(done.started.chatSessionId)
      },
      (error: unknown) => { setBusy(false); setFailure(t('draftFailed', { message: error instanceof Error ? error.message : String(error) })) },
    )
  }
  const problems = status.check?.problems ?? []
  return (
    <>
      <div className={css.banner} role="note" data-testid="roleplay-draft-banner">
        <div className={css.text}>
          {t('draftWarning')}
          <ul>{problems.slice(0, SHOWN).map(problem => <li key={`${problem.where}:${problem.message}`}>{problem.where}: {problem.message}</li>)}</ul>
          {problems.length + (status.check?.more ?? 0) > SHOWN && <span>{t('draftMore', { count: problems.length + (status.check?.more ?? 0) - SHOWN })}</span>}
          {confirming && <div role="alert">{t('draftDiscardConfirm')}</div>}
        </div>
        <div className={css.bannerActions}>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { decide('ask') }}>{busy ? t('draftBusy') : t('draftAsk')}</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { decide('keep') }}>{t('draftKeep')}</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (confirming) decide('discard'); else setConfirming(true) }}>{t('draftDiscard')}</Button>
        </div>
      </div>
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </>
  )
}
