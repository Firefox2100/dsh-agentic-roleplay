import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './StartSessionDialog.module.css'

/** Asks before a world goes back to how it was before its last card update. */
export function RevertUpdateDialog({ t, revert, onDone, onClose }: { t: TranslateNS<'roleplay.worlds'>; revert: () => Promise<{ keptIn: string }>; onDone: (keptIn: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const confirm = (): void => {
    setBusy(true)
    setError(undefined)
    revert().then(
      (done) => { onDone(done.keptIn) },
      (failure: unknown) => { setBusy(false); setError(t('revertFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    )
  }
  return (
    <Modal open onClose={onClose} title={t('revertTitle')} description={t('revertHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? t('reverting') : t('revertConfirm')}</Button></>}>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </Modal>
  )
}
