import { useId, useState } from 'react'
import { Modal } from '../../ui/Modal.tsx'
import { Button } from '../../ui/Button.tsx'
import { Input } from '../../ui/Input.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImportPreview } from '../../../shared/import-card.ts'
import { fetchCard } from './import-api.ts'
import css from './StartSessionDialog.module.css'

/** Reads a character card from a web address: the host fetches it, checks that it is a PNG or JSON card and offers what it holds, as an upload does. */
export function CardUrlDialog({ t, onRead, onClose }: { t: TranslateNS<'roleplay.worlds'>; onRead: (preview: ImportPreview) => void; onClose: () => void }) {
  const formId = useId()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = (): void => {
    if (address.trim() === '' || busy) return
    setBusy(true); setError(undefined)
    fetchCard(address.trim()).then(
      onRead,
      (failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }
  return (
    <Modal open onClose={onClose} title={t('cardUrlTitle')} description={t('cardUrlHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || address.trim() === ''}>{busy ? t('cardUrlReading') : t('cardUrlSubmit')}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label className={css.field}><span className={css.label}>{t('cardUrlAddress')}</span><Input value={address} placeholder={t('cardUrlPlaceholder')} data-modal-autofocus data-testid="roleplay-card-url" onChange={(event) => { setAddress(event.target.value) }} /></label>
        {error !== undefined && <p className={css.error} role="alert">{t('importUploadFailed', { message: error })}</p>}
      </form>
    </Modal>
  )
}
