import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal.tsx'
import { Button } from '../../ui/Button.tsx'
import { Tooltip } from '../../ui/Tooltip.tsx'
import { MediaImage } from '../media-image/MediaImage.tsx'
import { onPageVisible, pageVisible } from '../../visibility.ts'
import { describeImage, imageUrl, loadGalleryPage, updateImage, uploadImage, type GalleryFilter, type GalleryImage, type GalleryPage, type GalleryTarget } from './gallery-api.ts'
import { POLL_MS, awaitsDescriptions, sameGallery } from './polling.ts'
import type { GalleryLocaleKey } from './locales.ts'
import css from './GalleryView.module.css'
import { IconInfo, IconRefresh } from '../../ui/icons.tsx'


export type GalleryText = (key: GalleryLocaleKey, values?: Record<string, string | number>) => string
type Filter = GalleryFilter
type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; contents: GalleryPage }

/** How many pictures a page holds: the grid draws and loads these, not the whole gallery, which may hold thousands. */
const PAGE = 48

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function EditDialog({ t, image, onSave, onClose }: { t: GalleryText; image: GalleryImage; onSave: (update: { description: string; tags: string[] }) => Promise<void>; onClose: () => void }) {
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
        {image.cardLinks !== undefined && image.cardLinks.length > 0 && (
          <div className={css.editField} title={t('cardSourceHelp')}>
            <span className={css.editLabel}>{t('cardSource')}</span>
            {image.cardLinks.map(link => <span key={link.url} className={css.editHelp} data-testid="roleplay-gallery-source">{link.url}{link.pieces.length === 0 ? '' : ` (${link.pieces.join(', ')})`}</span>)}
          </div>
        )}
        {error !== undefined && <p className={css.error} role="alert">{t('updateFailed', { message: error })}</p>}
      </div>
    </Modal>
  )
}

/** Every image of a session or a world in a grid, with what each file says about it; pictures can be added, described and marked reusable. */
export function GalleryView({ t, target }: { t: GalleryText; target: GalleryTarget }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<GalleryImage | undefined>()
  const [describing, setDescribing] = useState<ReadonlySet<string>>(new Set())
  const [describeFailures, setDescribeFailures] = useState<Readonly<Record<string, string>>>({})

  const shownCount = useRef(PAGE)
  const read = useCallback((signal: AbortSignal, quiet = false, more = false) => {
    if (!quiet) setRefreshing(true)
    if (more) shownCount.current += PAGE
    loadGalleryPage(target, { offset: 0, limit: shownCount.current, filter }, signal).then(
      (contents) => { setLoad(current => (quiet && current.status === 'ready' && sameGallery(current.contents, contents) ? current : { status: 'ready', contents })); setRefreshing(false) },
      (failure: unknown) => { if (!signal.aborted && !quiet) { setLoad({ status: 'failed', message: messageOf(failure) }); setRefreshing(false) } },
    )
  }, [target.kind, target.id, filter])

  useEffect(() => {
    shownCount.current = PAGE
  }, [target.kind, target.id, filter])

  useEffect(() => {
    const abort = new AbortController()
    read(abort.signal, load.status === 'ready')
    return () => { abort.abort() }
  }, [read])

  const waiting = awaitsDescriptions(target.kind, load.status === 'ready' ? load.contents : undefined)
  useEffect(() => {
    if (!waiting) return
    const abort = new AbortController()
    const timer = window.setInterval(() => { if (pageVisible()) read(abort.signal, true) }, POLL_MS)
    const off = onPageVisible(() => { read(abort.signal, true) })
    return () => { window.clearInterval(timer); off(); abort.abort() }
  }, [waiting, read])

  if (load.status === 'loading') return <p className={css.message}>{t('loading')}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('loadFailed', { message: load.message })}</p>

  const add = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return
    setUploading(true)
    setNotice(undefined)
    for (const file of Array.from(files)) {
      try { await uploadImage(target, file, new AbortController().signal) } catch (failure) { setNotice(t('uploadFailed', { name: file.name, message: messageOf(failure) })) }
    }
    setUploading(false)
    read(new AbortController().signal)
  }
  const replace = (updated: GalleryImage): void => {
    setLoad(current => (current.status === 'ready' ? { status: 'ready', contents: { ...current.contents, images: current.contents.images.map(entry => (entry.path === updated.path ? updated : entry)) } } : current))
  }
  const mark = (image: GalleryImage, reusable: boolean): void => {
    updateImage(target, image.path, { reusable }, new AbortController().signal).then(replace, (failure: unknown) => { setNotice(t('updateFailed', { message: messageOf(failure) })) })
  }

  const describe = (image: GalleryImage): void => {
    setDescribing(current => new Set(current).add(image.path))
    setNotice(undefined)
    setDescribeFailures(({ [image.path]: _cleared, ...rest }) => rest)
    describeImage(target, image.path, new AbortController().signal).then(replace, (failure: unknown) => { setDescribeFailures(current => ({ ...current, [image.path]: messageOf(failure) })); setNotice(t('describeError', { message: messageOf(failure) })) }).finally(() => { setDescribing((current) => { const next = new Set(current); next.delete(image.path); return next }) })
  }

  const { images, failures, total, counts } = load.contents
  const labels = { description: t('description') ?? '', prompt: t('prompt') ?? '', subjects: t('subjects') ?? '', reusable: t('reusable') ?? '', uploaded: t('uploaded') ?? '', dialog: t('dialog') ?? '', close: t('close') ?? '' }
  const shown = images
  return (
    <div className={css.page} data-testid="roleplay-gallery">
      <div className={css.toolbar}>
        <span className={css.count}>{t(total === 1 ? 'countOne' : 'countOther', { count: total })}</span>
        <div className={css.actions}>
          <select className={css.select} value={filter} aria-label={t('tab')} onChange={(event) => { setFilter(event.target.value as Filter) }}>
            <option value="all">{`${t('all')} (${counts.all})`}</option>
            <option value="transient">{`${t('scenes')} (${counts.transient})`}</option>
            <option value="reference">{`${t('references')} (${counts.reference})`}</option>
            <option value="uploaded">{`${t('uploaded')} (${counts.uploaded})`}</option>
          </select>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => { picker.current?.click() }}>{uploading ? t('uploading') : t('upload')}</Button>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { void add(event.target.files); event.target.value = '' }} />
          <Button variant="outline" size="sm" icon={<IconRefresh />} disabled={refreshing} aria-busy={refreshing} onClick={() => { read(new AbortController().signal) }}>{refreshing ? t('refreshing') : t('refresh')}</Button>
        </div>
      </div>
      {notice !== undefined && <p className={css.error} role="alert">{notice}</p>}
      {shown.length === 0
        ? <p className={css.message}>{t(target.kind === 'worlds' ? 'emptyWorld' : 'empty')}</p>
        : (
          <ul className={css.grid}>
            {shown.map((image) => {
              const name = image.subjects.map(subject => subject.name).join(', ') || image.originalName || image.path
              const failed = describeFailures[image.path] ?? failures[image.path]
              return (
                <li key={image.path} className={css.cell}>
                  <div className={css.thumb}>
                    <MediaImage src={imageUrl(target, image)} alt={name} details={image} labels={labels} className={css.image ?? ''} onOpenClassName={css.open ?? ''} />
                    <span className={css.caption}>{name}</span>
                    {(image.pending === true || image.unreadable !== true) && (
                      <div className={css.footer}>
                        {image.pending === true && (
                          <span role={failed === undefined ? undefined : 'alert'}>
                            <Tooltip label={failed === undefined ? t(target.kind === 'worlds' ? 'pendingWorld' : 'pending') : t('describeFailed', { message: failed })} openOnClick maxWidth={360}>
                              <button type="button" className={failed === undefined ? css.status : css.statusError} aria-label={failed === undefined ? t(target.kind === 'worlds' ? 'pendingWorld' : 'pending') : t('describeFailed', { message: failed })}><IconInfo /></button>
                            </Tooltip>
                          </span>
                        )}
                        <span className={css.buttons}>
                          {image.unreadable !== true && <Button variant="outline" size="sm" onClick={() => { setEditing(image) }}>{t('edit')}</Button>}
                          {image.unreadable !== true && target.kind === 'worlds' && <Button variant="outline" size="sm" disabled={describing.has(image.path)} onClick={() => { describe(image) }}>{describing.has(image.path) ? t('describing') : t('describeNow')}</Button>}
                        </span>
                      </div>
                    )}
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
      {shown.length < total && <div className={css.more}><Button variant="outline" size="sm" disabled={refreshing} onClick={() => { read(new AbortController().signal, true, true) }}>{`${t('more')} (${shown.length}/${total})`}</Button></div>}
      {editing !== undefined && <EditDialog t={t} image={editing} onClose={() => { setEditing(undefined) }} onSave={async (update) => { replace(await updateImage(target, editing.path, update, new AbortController().signal)) }} />}
    </div>
  )
}
