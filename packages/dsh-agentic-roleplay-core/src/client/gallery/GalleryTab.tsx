import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { MediaImage } from '../widgets/media-image/MediaImage.tsx'
import { imageUrl, loadGallery, updateImage, uploadImage, type GalleryContents, type GalleryImage } from './gallery-api.ts'
import css from './GalleryTab.module.css'

export type GalleryTabProps = PropsRuntime<'conversation.view'> & PropsLocale<'roleplay.gallery'>
type Filter = 'all' | 'transient' | 'reference' | 'uploaded'
type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; contents: GalleryContents }

/** How often the list is read again while pictures are waiting to be described. */
const POLL_MS = 3000

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function EditDialog({ t, image, onSave, onClose }: { t: GalleryTabProps['t']; image: GalleryImage; onSave: (update: { description: string; tags: string[] }) => Promise<void>; onClose: () => void }) {
  const [description, setDescription] = useState(image.description ?? '')
  const [tags, setTags] = useState(image.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    onSave({ description: description.trim(), tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(tag => tag !== '') }).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('editTitle')} description={t('editHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" disabled={busy || description.trim() === ''} onClick={save}>{busy ? t('saving') : t('save')}</Button></>}>
      <div className={css.edit}>
        <label className={css.editField}><span className={css.editLabel}>{t('description')}</span><textarea className={css.editArea} rows={6} value={description} onChange={(event) => { setDescription(event.target.value) }} /></label>
        <label className={css.editField}><span className={css.editLabel}>{t('tags')}</span><input className={css.editInput} value={tags} onChange={(event) => { setTags(event.target.value) }} /><span className={css.editHelp}>{t('tagsHelp')}</span></label>
        {error !== undefined && <p className={css.error} role="alert">{t('updateFailed', { message: error })}</p>}
      </div>
    </Modal>
  )
}

/** Every image of the current session in a grid, with what each file says about it; pictures can be added and marked reusable. */
export function GalleryTab({ t, sessionId }: GalleryTabProps) {
  const session = roleplaySessionOf(sessionId)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<GalleryImage | undefined>()

  const read = useCallback((signal: AbortSignal) => {
    if (session === undefined) return
    setRefreshing(true)
    loadGallery(session, signal).then(
      (contents) => { setLoad({ status: 'ready', contents }); setRefreshing(false) },
      (failure: unknown) => { if (!signal.aborted) { setLoad({ status: 'failed', message: messageOf(failure) }); setRefreshing(false) } },
    )
  }, [session])

  useEffect(() => {
    const abort = new AbortController()
    read(abort.signal)
    return () => { abort.abort() }
  }, [read])

  const waiting = load.status === 'ready' && load.contents.images.some(image => image.pending === true && load.contents.failures[image.path] === undefined)
  useEffect(() => {
    if (!waiting) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => { read(abort.signal) }, POLL_MS)
    return () => { window.clearTimeout(timer); abort.abort() }
  }, [waiting, read, load])

  if (session === undefined) return <p className={css.message}>{t('notRoleplay')}</p>
  if (load.status === 'loading') return <p className={css.message}>{t('loading')}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('loadFailed', { message: load.message })}</p>

  const add = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return
    setUploading(true)
    setNotice(undefined)
    for (const file of Array.from(files)) {
      try { await uploadImage(session, file, new AbortController().signal) } catch (failure) { setNotice(t('uploadFailed', { name: file.name, message: messageOf(failure) })) }
    }
    setUploading(false)
    read(new AbortController().signal)
  }
  const replace = (updated: GalleryImage): void => {
    setLoad(current => (current.status === 'ready' ? { status: 'ready', contents: { ...current.contents, images: current.contents.images.map(entry => (entry.path === updated.path ? updated : entry)) } } : current))
  }
  const mark = (image: GalleryImage, reusable: boolean): void => {
    updateImage(session, image.path, { reusable }, new AbortController().signal).then(replace, (failure: unknown) => { setNotice(t('updateFailed', { message: messageOf(failure) })) })
  }

  const { images, failures } = load.contents
  const labels = { description: t('description'), prompt: t('prompt'), subjects: t('subjects'), reusable: t('reusable'), uploaded: t('uploaded'), dialog: t('dialog'), close: t('close') }
  const shown = images.filter(image => filter === 'all' || (filter === 'uploaded' ? image.origin === 'uploaded' : image.purpose === filter))
  return (
    <div className={css.page} data-testid="roleplay-gallery">
      <div className={css.toolbar}>
        <span className={css.count}>{t(shown.length === 1 ? 'countOne' : 'countOther', { count: shown.length })}</span>
        <div className={css.actions}>
          <select className={css.select} value={filter} aria-label={t('tab')} onChange={(event) => { setFilter(event.target.value as Filter) }}>
            <option value="all">{t('all')}</option>
            <option value="transient">{t('scenes')}</option>
            <option value="reference">{t('references')}</option>
            <option value="uploaded">{t('uploaded')}</option>
          </select>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => { picker.current?.click() }}>{uploading ? t('uploading') : t('upload')}</Button>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { void add(event.target.files); event.target.value = '' }} />
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} aria-busy={refreshing} onClick={() => { read(new AbortController().signal) }}>{refreshing ? t('refreshing') : t('refresh')}</Button>
        </div>
      </div>
      {notice !== undefined && <p className={css.error} role="alert">{notice}</p>}
      {shown.length === 0
        ? <p className={css.message}>{t('empty')}</p>
        : (
          <ul className={css.grid}>
            {shown.map((image) => {
              const name = image.subjects.map(subject => subject.name).join(', ') || image.originalName || image.path
              const failed = failures[image.path]
              return (
                <li key={image.path} className={css.cell}>
                  <div className={css.thumb}>
                    <MediaImage src={imageUrl(session, image)} alt={name} details={image} labels={labels} className={css.image} onOpenClassName={css.open} />
                    <span className={css.caption}>{name}</span>
                    {image.pending === true && <span className={failed === undefined ? css.status : css.statusError}>{failed === undefined ? t('pending') : t('describeFailed', { message: failed })}</span>}
                    {image.unreadable !== true && image.pending !== true && <button type="button" className={css.editButton} onClick={() => { setEditing(image) }}>{t('edit')}</button>}
                    {image.origin === 'generated' && image.unreadable !== true && (
                      <label className={css.reusable} title={t('reusableHint')}>
                        <input type="checkbox" checked={image.reusable} onChange={(event) => { mark(image, event.target.checked) }} />
                        {t('reusable')}
                      </label>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {editing !== undefined && <EditDialog t={t} image={editing} onClose={() => { setEditing(undefined) }} onSave={async (update) => { replace(await updateImage(session, editing.path, update, new AbortController().signal)) }} />}
    </div>
  )
}
