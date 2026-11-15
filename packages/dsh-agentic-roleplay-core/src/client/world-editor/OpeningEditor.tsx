import { useEffect, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import { isImagePath, partsText, type OpeningPart } from '../../shared/opening.ts'
import { imageUrl, loadGallery, type GalleryImage, type GalleryTarget } from '../widgets/gallery-view/gallery-api.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'

export interface OpeningValue { text: string; parts?: OpeningPart[] }

interface Props { t: Translate; value: OpeningValue; characters: readonly { id: string; name: string }[]; /** The world whose pictures the opening may show; without it no picture can be added. */ worldId?: string; rows?: number; onChange: (value: OpeningValue) => void }

const words = partsText

/** What a picture is called in a list: what it shows, else the name it was added under, else its path. */
const nameOf = (image: GalleryImage): string => image.description?.trim().slice(0, 70) || image.originalName || image.path

/** An opening, as plain narration or as ordered parts of narration and spoken lines; the person chooses the form and nothing is converted behind their back. */
export function OpeningEditor({ t, value, characters, worldId, rows = 6, onChange }: Props) {
  const parts = value.parts
  const [pictures, setPictures] = useState<GalleryImage[]>([])
  const target: GalleryTarget | undefined = worldId === undefined ? undefined : { kind: 'worlds', id: worldId }
  useEffect(() => {
    if (worldId === undefined) return
    const abort = new AbortController()
    loadGallery({ kind: 'worlds', id: worldId }, abort.signal).then((contents) => { setPictures(contents.images.filter(image => image.unreadable !== true && isImagePath(image.path))) }, () => { setPictures([]) })
    return () => { abort.abort() }
  }, [worldId])
  if (parts === undefined) {
    return (
      <div className={css.wide}>
        <textarea className={css.area} rows={rows} value={value.text} onChange={(event) => { onChange({ text: event.target.value }) }} />
        <span className={css.help}>{t('op_plainHelp')}</span>
        <Button variant="ghost" size="sm" onClick={() => { onChange({ text: value.text, parts: value.text.trim() === '' ? [] : [{ type: 'narration', text: value.text.trim() }] }) }}>{t('op_toParts')}</Button>
      </div>
    )
  }
  const set = (next: OpeningPart[]): void => { onChange({ text: words(next), parts: next }) }
  const change = (at: number, part: OpeningPart): void => { set(parts.map((entry, index) => (index === at ? part : entry))) }
  const move = (at: number, by: number): void => { const next = [...parts]; const [taken] = next.splice(at, 1); next.splice(at + by, 0, taken!); set(next) }
  return (
    <div className={css.wide} data-testid="roleplay-opening-parts">
      <span className={css.help}>{t('op_partsHelp')}</span>
      {parts.map((part, at) => (part.type === 'image' ? (
        <div className={css.grid} key={at} data-testid="roleplay-opening-picture">
          <label className={css.field}>
            <span className={css.label}>{t('op_picture')}</span>
            <select className={css.select} value={part.path} onChange={(event) => { change(at, { type: 'image', path: event.target.value }) }}>
              {!pictures.some(image => image.path === part.path) && <option value={part.path}>{part.path}</option>}
              {pictures.map(image => <option key={image.path} value={image.path}>{nameOf(image)}</option>)}
            </select>
            {!pictures.some(image => image.path === part.path) && pictures.length > 0 && <span className={css.help}>{t('op_pictureMissing')}</span>}
          </label>
          {target !== undefined && pictures.find(image => image.path === part.path) !== undefined && <img src={imageUrl(target, pictures.find(image => image.path === part.path)!)} alt="" style={{ maxHeight: 72, maxWidth: 128, objectFit: 'cover' }} />}
          <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => { move(at, -1) }}>{t('op_up')}</Button>
          <Button variant="ghost" size="sm" disabled={at === parts.length - 1} onClick={() => { move(at, 1) }}>{t('op_down')}</Button>
          <Button variant="ghost" size="sm" onClick={() => { set(parts.filter((_, index) => index !== at)) }}>{t('op_remove')}</Button>
        </div>
      ) : (
        <div className={css.grid} key={at}>
          <label className={css.field}>
            <span className={css.label}>{t('op_speaker')}</span>
            <select className={css.select} value={part.type === 'narration' ? '' : part.character} onChange={(event) => { change(at, event.target.value === '' ? { type: 'narration', text: part.text } : { type: 'utterance', character: event.target.value, text: part.text }) }}>
              <option value="">{t('op_narration')}</option>
              {characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
              {part.type === 'utterance' && !characters.some(character => character.id === part.character) && <option value={part.character}>{part.character}</option>}
            </select>
          </label>
          <label className={`${css.field} ${css.wide}`}>
            <span className={css.label}>{t('op_text')}</span>
            <textarea className={css.area} rows={3} value={part.text} onChange={(event) => { change(at, { ...part, text: event.target.value }) }} />
          </label>
          <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => { move(at, -1) }}>{t('op_up')}</Button>
          <Button variant="ghost" size="sm" disabled={at === parts.length - 1} onClick={() => { move(at, 1) }}>{t('op_down')}</Button>
          <Button variant="ghost" size="sm" onClick={() => { set(parts.filter((_, index) => index !== at)) }}>{t('op_remove')}</Button>
        </div>
      )))}
      <Button variant="ghost" size="sm" onClick={() => { set([...parts, { type: 'narration', text: '' }]) }}>{t('op_addNarration')}</Button>
      <Button variant="ghost" size="sm" disabled={characters.length === 0} onClick={() => { set([...parts, { type: 'utterance', character: characters[0]!.id, text: '' }]) }}>{t('op_addSpeech')}</Button>
      <Button variant="ghost" size="sm" disabled={worldId === undefined || pictures.length === 0} title={pictures.length === 0 ? t('op_noPictures') : t('op_choosePicture')} onClick={() => { set([...parts, { type: 'image', path: pictures[0]!.path }]) }}>{t('op_addImage')}</Button>
      <Button variant="ghost" size="sm" disabled={parts.some(part => part.type !== 'narration')} title={parts.some(part => part.type !== 'narration') ? t('op_toPlainBlockedMore') : undefined} onClick={() => { onChange({ text: words(parts) }) }}>{t('op_toPlain')}</Button>
    </div>
  )
}
