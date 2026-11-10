import { useState } from 'react'
import { Modal } from '../../ui/Modal.tsx'
import { Button } from '../../ui/Button.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExportKind } from './sessions-controller.ts'
import css from './DeleteSessionDialog.module.css'

const KINDS: readonly ExportKind[] = ['story', 'annotated', 'data', 'archive']

/** Asks what to export of a session: the story to read, the story with its notes and every turn, the same as data, or the whole story to put back. */
export function ExportSessionDialog({ t, name, onExport, onCancel }: {
  t: TranslateNS<'roleplay.sessions'>
  name: string
  onExport: (kind: ExportKind) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<ExportKind>('story')
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('exportTitle')}
      closeLabel={t('close')}
      footer={(
        <>
          <Button variant="ghost" data-modal-autofocus onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => { onExport(kind) }}>{t('exportConfirm')}</Button>
        </>
      )}
    >
      <div className={css.body}>
        <p className={css.question}>{t('exportQuestion', { name })}</p>
        <fieldset className={css.choice}>
          {KINDS.map(option => (
            <label key={option}><input type="radio" name="roleplay-export-kind" checked={kind === option} onChange={() => { setKind(option) }} /> {t(`export_${option}`)}</label>
          ))}
        </fieldset>
      </div>
    </Modal>
  )
}
