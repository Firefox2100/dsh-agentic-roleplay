import { useEffect, useId, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { addAvatarsToWorld, listAvatars, type AvatarSummary } from '../../avatars-api.ts'
import { AvatarChoices } from '../../widgets/avatar-choices/AvatarChoices.tsx'
import css from './StartSessionDialog.module.css'

/** Asks which avatars become characters of a world's own files. */
export function AddAvatarsDialog({ t, worldId, worldName, onAdded, onClose }: { t: TranslateNS<'roleplay.worlds'>; worldId: string; worldName: string; onAdded: () => void; onClose: () => void }) {
  const formId = useId()
  const [avatars, setAvatars] = useState<AvatarSummary[]>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    listAvatars(abort.signal).then(setAvatars, (failure: unknown) => { if (!abort.signal.aborted) setError(t('addAvatarsLoadFailed', { message: failure instanceof Error ? failure.message : String(failure) })) })
    return () => { abort.abort() }
  }, [t])

  const add = (): void => {
    if (selected.size === 0 || busy) return
    setBusy(true); setError(undefined)
    addAvatarsToWorld(worldId, [...selected], new AbortController().signal).then(onAdded, (failure: unknown) => { setBusy(false); setError(t('addAvatarsFailed', { message: failure instanceof Error ? failure.message : String(failure) })) })
  }
  const toggle = (key: string): void => { setSelected((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next }) }

  return (
    <Modal open onClose={onClose} title={t('addAvatarsTitle')} description={worldName} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || selected.size === 0}>{busy ? t('addAvatarsAdding') : t('addAvatars')}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); add() }}>
        <p className={css.message}>{t('addAvatarsHelp')}</p>
        {avatars === undefined && error === undefined && <p className={css.message}>{t('loadingCharacters')}</p>}
        {avatars?.length === 0 && <p className={css.message}>{t('addAvatarsNone')}</p>}
        {avatars !== undefined && <AvatarChoices avatars={avatars} selected={selected} disabled={busy} onToggle={toggle} />}
        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
