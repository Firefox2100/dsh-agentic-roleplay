import { Button } from '../ui/Button.tsx'
import { hasSpeech, type OpeningPart } from '../../shared/opening.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'

export interface OpeningValue { text: string; parts?: OpeningPart[] }

interface Props { t: Translate; value: OpeningValue; characters: readonly { id: string; name: string }[]; rows?: number; onChange: (value: OpeningValue) => void }

const words = (parts: readonly OpeningPart[]): string => parts.map(part => part.text).join('\n\n')

/** An opening, as plain narration or as ordered parts of narration and spoken lines; the person chooses the form and nothing is converted behind their back. */
export function OpeningEditor({ t, value, characters, rows = 6, onChange }: Props) {
  const parts = value.parts
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
      {parts.map((part, at) => (
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
      ))}
      <Button variant="ghost" size="sm" onClick={() => { set([...parts, { type: 'narration', text: '' }]) }}>{t('op_addNarration')}</Button>
      <Button variant="ghost" size="sm" disabled={characters.length === 0} onClick={() => { set([...parts, { type: 'utterance', character: characters[0]!.id, text: '' }]) }}>{t('op_addSpeech')}</Button>
      <Button variant="ghost" size="sm" disabled={hasSpeech(parts)} title={hasSpeech(parts) ? t('op_toPlainBlocked') : undefined} onClick={() => { onChange({ text: words(parts) }) }}>{t('op_toPlain')}</Button>
    </div>
  )
}
