import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchFace } from './branch-controller.ts'
import css from './BranchDialog.module.css'

export type BranchDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'roleplay.branch'>
  & InjectFace<BranchFace>

/** Asks for the name of a session that was just branched off another. */
export function BranchDialog({ t, useBranch, save, keep }: BranchDialogProps) {
  const state = useBranch(snapshot => snapshot)
  if (state.pending === undefined) return null
  return <Naming key={state.pending.id} t={t} initial={state.pending.name} saving={state.saving} error={state.error} save={save} keep={keep} />
}

function Naming({ t, initial, saving, error, save, keep }: {
  t: BranchDialogProps['t']
  initial: string
  saving: boolean
  error: string | undefined
  save: (name: string) => void
  keep: () => void
}) {
  const formId = useId()
  const [name, setName] = useState(initial)
  const canSave = name.trim() !== '' && !saving
  return (
    <Modal
      open
      onClose={keep}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      footer={(
        <>
          <Button variant="ghost" onClick={keep} disabled={saving}>{t('keep')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave}>{saving ? t('saving') : t('save')}</Button>
        </>
      )}
    >
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); if (canSave) save(name) }}>
        <label className={css.field}>
          <span className={css.label}>{t('name')}</span>
          <Input value={name} maxLength={200} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} />
        </label>
        {error !== undefined && <p className={css.error} role="alert">{t('failed', { message: error })}</p>}
      </form>
    </Modal>
  )
}
