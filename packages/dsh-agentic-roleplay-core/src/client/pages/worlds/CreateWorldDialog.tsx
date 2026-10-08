import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { API_PREFIX, type WorldSummary } from '../../../shared/worlds.ts'
import css from './StartSessionDialog.module.css'

export function CreateWorldDialog({ t, onCreated, onClose }: { t: TranslateNS<'roleplay.worlds'>; onCreated: (world: WorldSummary) => void; onClose: () => void }) {
  const formId = useId()
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const create = async (): Promise<void> => {
    if (folder.trim() === '' || name.trim() === '' || submitting) return
    setSubmitting(true); setError(undefined)
    try {
      const response = await fetch(`${API_PREFIX}/worlds`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder, name }) })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined
        const detail = Array.isArray(body?.problems) ? body.problems.join('; ') : typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`
        throw new Error(detail)
      }
      onCreated(await response.json() as WorldSummary)
    } catch (failure) {
      setSubmitting(false); setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  return <Modal open onClose={onClose} title={t('createWorldTitle')} description={t('createWorldHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={submitting} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={submitting || folder.trim() === '' || name.trim() === ''}>{submitting ? t('creatingWorld') : t('createWorld')}</Button></>}><form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); void create() }}><label className={css.field}><span className={css.label}>{t('worldFolder')}</span><Input value={folder} maxLength={100} data-modal-autofocus onChange={event => { setFolder(event.target.value) }} /><span className={css.message}>{t('worldFolderHelp')}</span></label><label className={css.field}><span className={css.label}>{t('worldName')}</span><Input value={name} maxLength={200} onChange={event => { setName(event.target.value) }} /></label>{error !== undefined && <p className={css.error} role="alert">{t('createWorldFailed', { message: error })}</p>}</form></Modal>
}
