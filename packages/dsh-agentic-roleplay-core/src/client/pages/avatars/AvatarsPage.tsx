import { useEffect, useId, useMemo, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconRefreshOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AVATARS_WORLD_ID } from '../../../shared/avatars.ts'
import type { AvatarSummary } from '../../avatars-api.ts'
import type {} from '../../panel/slot-contract.ts'
import { worldSource } from '../../world-editor/authored-world-source.ts'
import { WorldEditor } from '../../world-editor/WorldEditor.tsx'
import type { AvatarsFace } from './avatars-controller.ts'
import css from './AvatarsPage.module.css'

export type AvatarsPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.avatars'>
  & InjectFace<AvatarsFace>

const hueOf = (name: string): number => Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0)

function Card({ avatar, editLabel, deleteLabel, onEdit, onDelete }: { avatar: AvatarSummary; editLabel: string; deleteLabel: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className={css.card}>
      <button type="button" className={css.open} aria-label={`${editLabel}: ${avatar.name}`} onClick={onEdit}>
        {avatar.portrait === undefined
          ? <span className={css.placeholder} style={{ background: `hsl(${hueOf(avatar.name)} 22% 88%)` }} aria-hidden="true">{Array.from(avatar.name)[0]?.toUpperCase()}</span>
          : <img className={css.portrait} src={avatar.portrait} alt="" loading="lazy" decoding="async" />}
        <span className={css.text}>
          <span className={css.name}>{avatar.name}</span>
          {avatar.summary !== '' && <span className={css.summary}>{avatar.summary}</span>}
        </span>
      </button>
      <Button variant="ghost" size="sm" onClick={onDelete}>{deleteLabel}</Button>
    </li>
  )
}

function CreateDialog({ t, create, onClose, onCreated }: { t: AvatarsPageProps['t']; create: AvatarsFace['create']; onClose: () => void; onCreated: (key: string, name: string) => void }) {
  const formId = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = (): void => {
    if (name.trim() === '' || busy) return
    setBusy(true); setError(undefined)
    create(name.trim()).then(key => { onCreated(key, name.trim()) }, (failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : String(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('avatarCreateTitle')} description={t('avatarCreateHelp')} closeLabel={t('avatarsClose')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('avatarsCancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || name.trim() === ''}>{busy ? t('avatarCreating') : t('avatarCreate')}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label className={css.field}><span className={css.label}>{t('avatarName')}</span><Input value={name} maxLength={200} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} /></label>
        {error !== undefined && <p className={css.error} role="alert">{t('avatarCreateFailed', { message: error })}</p>}
      </form>
    </Modal>
  )
}

function DeleteDialog({ t, avatar, remove, onClose }: { t: AvatarsPageProps['t']; avatar: AvatarSummary; remove: AvatarsFace['remove']; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const confirm = (): void => {
    setBusy(true); setError(undefined)
    remove(avatar.key).then(onClose, (failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : String(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('avatarDeleteTitle')} description={t('avatarDeleteHelp', { name: avatar.name })} closeLabel={t('avatarsClose')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('avatarsCancel')}</Button><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? t('avatarDeleting') : t('avatarDelete')}</Button></>}>
      {error !== undefined && <p className={css.error} role="alert">{t('avatarDeleteFailed', { message: error })}</p>}
    </Modal>
  )
}

/** The player avatars: characters to play in any world, edited like the characters of a world. */
export function AvatarsPage({ t, useAvatars, load, refresh, create, remove }: AvatarsPageProps) {
  const state = useAvatars(snapshot => snapshot)
  const [editing, setEditing] = useState<AvatarSummary | undefined>()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<AvatarSummary | undefined>()
  const source = useMemo(() => worldSource(AVATARS_WORLD_ID), [])

  useEffect(() => { load() }, [load])

  if (editing !== undefined) {
    return (
      <div className={css.page} data-testid="roleplay-avatar-editor">
        <div className={css.editHeader}>
          <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular />} onClick={() => { setEditing(undefined); refresh() }}>{t('avatarsBack')}</Button>
          <span className={css.editTitle}>{editing.name}</span>
        </div>
        <div className={css.editBody}>
          <WorldEditor t={t} source={source} notEditable={t('avatarsMissing')} only={['characters']} warnNoPlayable={false} focus={editing.key} />
        </div>
      </div>
    )
  }

  const avatars = state.avatars ?? []
  const failedWithoutData = state.status === 'failed' && state.avatars === undefined
  return (
    <div className={css.page} data-testid="roleplay-avatars-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.avatars === undefined ? '' : t(avatars.length === 1 ? 'avatarsCountOne' : 'avatarsCountOther', { count: avatars.length })}</span>
        <div className={css.actions}>
          <Button variant="primary" size="sm" onClick={() => { setCreating(true) }}>{t('avatarCreate')}</Button>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={state.refreshing || state.status === 'loading'} aria-busy={state.refreshing} onClick={refresh}>{state.refreshing ? t('avatarsRefreshing') : t('avatarsRefresh')}</Button>
        </div>
      </div>
      {state.error !== undefined && !failedWithoutData && <p className={css.error} role="alert">{t('avatarsLoadFailed', { message: state.error })}</p>}
      <div className={css.viewport}>
        {state.status === 'idle' || state.status === 'loading'
          ? <p className={css.message}>{t('avatarsLoading')}</p>
          : failedWithoutData
            ? <p className={css.error} role="alert">{t('avatarsLoadFailed', { message: state.error ?? '' })}</p>
            : avatars.length === 0
              ? <p className={css.message}>{t('avatarsEmpty')}</p>
              : <ul className={css.grid}>{avatars.map(avatar => <Card key={avatar.key} avatar={avatar} editLabel={t('avatarEdit')} deleteLabel={t('avatarDelete')} onEdit={() => { setEditing(avatar) }} onDelete={() => { setDeleting(avatar) }} />)}</ul>}
      </div>
      {creating && <CreateDialog t={t} create={create} onClose={() => { setCreating(false) }} onCreated={(key, name) => { setCreating(false); setEditing({ key, name, summary: '' }) }} />}
      {deleting !== undefined && <DeleteDialog t={t} avatar={deleting} remove={remove} onClose={() => { setDeleting(undefined) }} />}
    </div>
  )
}
