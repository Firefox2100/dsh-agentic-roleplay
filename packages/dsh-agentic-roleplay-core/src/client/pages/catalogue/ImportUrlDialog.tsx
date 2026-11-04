import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogueLink } from '../../../shared/catalogue.ts'
import { install, resolveLink } from './catalogue-api.ts'
import type { CatalogueLocaleKey } from './locales.ts'
import css from './CataloguePage.module.css'

type Translate = (key: CatalogueLocaleKey, values?: Record<string, string | number>) => string

/** Installs a world from the address of its archive, or opens the resource a page address of a configured catalogue names; an address on a configured catalogue's site is asked for with that catalogue's key. */
export function ImportUrlDialog({ t, onClose, onInstalled, onLink }: { t: Translate; onClose: () => void; onInstalled: (name: string, packs: string[]) => void; onLink: (link: CatalogueLink) => void }) {
  const formId = useId()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = (): void => {
    if (address.trim() === '' || busy) return
    setBusy(true); setError(undefined)
    resolveLink(address.trim()).then(
      async (link) => {
        if (link !== undefined) { onLink(link); return }
        const result = await install({ url: address.trim() })
        onInstalled(result.world.name, result.packs)
      },
      (failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }
  return (
    <Modal open onClose={onClose} title={t('importTitle')} description={t('importHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || address.trim() === ''}>{busy ? t('installing') : t('importSubmit')}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label className={css.field}><span className={css.label}>{t('importAddress')}</span><Input value={address} placeholder={t('importAddressPlaceholder')} data-modal-autofocus onChange={(event) => { setAddress(event.target.value) }} /></label>
        {error !== undefined && <p className={css.notice} role="alert">{t('installFailed', { message: error })}</p>}
      </form>
    </Modal>
  )
}
