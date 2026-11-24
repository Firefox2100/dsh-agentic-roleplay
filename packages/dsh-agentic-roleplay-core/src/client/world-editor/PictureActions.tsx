import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import { Modal } from '../ui/Modal.tsx'
import { imageUrl, loadGallery, type GalleryImage, type GalleryTarget } from '../widgets/gallery-view/gallery-api.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './PictureActions.module.css'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const isPng = (image: GalleryImage): boolean => image.path.toLowerCase().endsWith('.png') && image.unreadable !== true

/** A picture of the world's gallery as the file an upload would have sent, so the one path that checks and stores a picture serves both ways of bringing one. */
async function fileOf(target: GalleryTarget, image: GalleryImage, signal: AbortSignal): Promise<File> {
  const response = await fetch(imageUrl(target, image), { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return new File([await response.blob()], image.path.split('/').at(-1) ?? 'picture.png', { type: 'image/png' })
}

/** The gallery's PNG pictures in a grid; choosing one hands it back as a file. */
function PicturePicker({ t, target, onPick, onClose }: { t: Translate; target: GalleryTarget; onPick: (file: File) => void; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; images: GalleryImage[] } | { status: 'failed'; message: string }>({ status: 'loading' })
  const [error, setError] = useState<string>()
  const [choosing, setChoosing] = useState<string>()
  const download = useRef<AbortController>()
  useEffect(() => {
    const abort = new AbortController()
    loadGallery(target, abort.signal).then(
      (contents) => { setState({ status: 'ready', images: contents.images.filter(isPng) }) },
      (failure: unknown) => { if (!abort.signal.aborted) setState({ status: 'failed', message: messageOf(failure) }) },
    )
    return () => { abort.abort(); download.current?.abort() }
  }, [target.kind, target.id])
  const choose = (image: GalleryImage): void => {
    setError(undefined)
    setChoosing(image.path)
    const abort = new AbortController()
    download.current = abort
    fileOf(target, image, abort.signal).then(onPick, (failure: unknown) => {
      if (!abort.signal.aborted) { setChoosing(undefined); setError(messageOf(failure)) }
    })
  }
  return (
    <Modal open onClose={onClose} title={t('galleryPickTitle')} description={t('galleryPickHelp')} closeLabel={t('gallery_close')}>
      {state.status === 'loading' && <p className={css.note}>{t('galleryPickLoading')}</p>}
      {state.status === 'failed' && <p className={css.error} role="alert">{t('galleryPickFailed', { message: state.message })}</p>}
      {state.status === 'ready' && state.images.length === 0 && <p className={css.note}>{t('galleryPickEmpty')}</p>}
      {error !== undefined && <p className={css.error} role="alert">{t('galleryPickFailed', { message: error })}</p>}
      {state.status === 'ready' && state.images.length > 0 && (
        <div className={css.grid}>
          {state.images.map(image => (
            <button key={image.path} type="button" className={css.tile} title={image.description ?? image.path} aria-label={image.description ?? image.path} aria-busy={choosing === image.path} disabled={choosing !== undefined} onClick={() => { choose(image) }}>
              <img className={css.thumb} src={imageUrl(target, image)} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** The two ways of giving a character, place or thing a picture besides generating one: a PNG from the computer, or one already in the gallery. */
export function PictureActions({ t, disabled, gallery, onFile }: { t: Translate; disabled: boolean; gallery?: GalleryTarget | undefined; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  return (
    <div className={css.actions}>
      <input ref={input} type="file" accept="image/png" hidden disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) onFile(file) }} />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => { input.current?.click() }}>{t('pictureUpload')}</Button>
      {gallery !== undefined && <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setPicking(true) }}>{t('galleryChoose')}</Button>}
      {picking && gallery !== undefined && <PicturePicker t={t} target={gallery} onPick={(file) => { setPicking(false); onFile(file) }} onClose={() => { setPicking(false) }} />}
    </div>
  )
}
