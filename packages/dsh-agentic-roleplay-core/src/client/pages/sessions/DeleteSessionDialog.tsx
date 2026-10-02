import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Removal } from './sessions-controller.ts'
import css from './DeleteSessionDialog.module.css'

/** Asks for confirmation before a session and everything saved with it is removed. */
export function DeleteSessionDialog({ t, removal, onConfirm, onCancel }: {
  t: TranslateNS<'roleplay.sessions'>
  removal: Removal
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('deleteTitle')}
      closeLabel={t('close')}
      footer={(
        <>
          <Button variant="ghost" data-modal-autofocus onClick={onCancel} disabled={removal.deleting}>{t('cancel')}</Button>
          <Button variant="primary" onClick={onConfirm} disabled={removal.deleting}>
            {removal.deleting ? t('deleting') : t('deleteConfirm')}
          </Button>
        </>
      )}
    >
      <div className={css.body}>
        <p className={css.question}>{t('deleteQuestion', { name: removal.name })}</p>
        <p className={css.warning}>{t('deleteWarning')}</p>
        {removal.error !== undefined && <p className={css.error} role="alert">{t('deleteFailed', { message: removal.error })}</p>}
      </div>
    </Modal>
  )
}
