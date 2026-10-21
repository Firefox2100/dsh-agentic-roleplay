import { useState } from 'react'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImportChoices, ImportPreview, OpeningChoice } from '../../../shared/import-card.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'
import type { ImportCardKey } from './locales.ts'
import css from './ImportCard.module.css'

type T = (key: ImportCardKey, values?: Record<string, string | number>) => string

export const pictureUrl = (id: string): string => `${API_PREFIX}/worlds/import/picture?id=${encodeURIComponent(id)}`

const same = (a: OpeningChoice, b: OpeningChoice): boolean => a.kind === b.kind && (a.kind !== 'alternate' || (b.kind === 'alternate' && a.index === b.index))

function Text({ label, text, t, note }: { label: string; text: string; t: T; note?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.field}>
      <button type="button" className={css.fieldHead} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <span className={css.fieldTitle}>{label}</span>
        <span className={css.fieldMeta}>{text.trim() === '' ? t('ic_empty') : `${text.length}`}</span>
      </button>
      {note !== undefined && <p className={css.note}>{note}</p>}
      {open && text.trim() !== '' && <pre className={css.text}>{text}</pre>}
    </div>
  )
}

/**
 * What a card holds, for the person to look through and decide what becomes of it: which lorebook entries are read at all, and which greeting opens the story.
 * The caller says what starting and cancelling do, because a card comes from a file or from a catalogue.
 */
export function ImportCard({ t, preview, start: begin, discard, onCancelled, onStarted }: {
  t: T
  preview: ImportPreview
  /** Makes the world with the choices; rejects with the reason when it cannot. */
  start: (choices: ImportChoices) => Promise<{ chatSessionId: string; started: boolean }>
  /** Lets the host forget the card; called before `onCancelled`. */
  discard: () => Promise<void>
  onCancelled: () => void
  onStarted: (chatSessionId: string, started: boolean) => void
}) {
  const { card } = preview
  const entries = card.book?.entries ?? []
  const [name, setName] = useState(preview.choices.name)
  const [off, setOff] = useState(() => new Set(preview.choices.disabledEntries))
  const [opening, setOpening] = useState<OpeningChoice>(preview.choices.opening)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  const greetings: { choice: OpeningChoice; label: string; text: string }[] = [
    ...(card.firstMessage.trim() === '' ? [] : [{ choice: { kind: 'first' } as OpeningChoice, label: t('ic_openingFirst'), text: card.firstMessage }]),
    ...card.alternateGreetings.flatMap((text, index) => (text.trim() === '' ? [] : [{ choice: { kind: 'alternate', index } as OpeningChoice, label: t('ic_openingAlternate', { number: index + 1 }), text }])),
  ]
  const toggle = (id: string, on: boolean): void => { const next = new Set(off); if (on) next.delete(id); else next.add(id); setOff(next) }
  const toggleOpen = (id: string): void => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next) }
  const choices = (): ImportChoices => ({ name: name.trim(), disabledEntries: [...off], opening })

  const start = (): void => {
    if (name.trim() === '' || starting) return
    setStarting(true)
    setError(undefined)
    begin(choices()).then(
      (started) => { onStarted(started.chatSessionId, started.started) },
      (failure: unknown) => { setStarting(false); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }
  const cancel = (): void => { void discard().finally(onCancelled) }
  const on = entries.length - off.size

  return (
    <div className={css.page} data-testid="roleplay-import">
      <div className={css.header}>
        <span className={css.title}>{t('ic_title')}</span>
        <span className={css.space} />
        <Button variant="ghost" size="sm" disabled={starting} onClick={cancel}>{t('ic_cancel')}</Button>
        <Button variant="primary" size="sm" disabled={name.trim() === '' || starting} onClick={start}>{starting ? t('ic_starting') : t('ic_start')}</Button>
      </div>
      {error !== undefined && <p className={css.error} role="alert">{t('ic_startFailed', { message: error })}</p>}
      <div className={css.body}>
        <section className={css.top}>
          {preview.hasAvatar
            ? <img className={css.picture} src={pictureUrl(preview.id)} alt="" loading="lazy" decoding="async" />
            : <div className={`${css.picture} ${css.noPicture}`}>{t('ic_noPicture')}</div>}
          <div className={css.about}>
            <label className={css.label}>
              <span>{t('ic_worldName')}</span>
              <Input value={name} maxLength={200} onChange={(event) => { setName(event.target.value) }} />
            </label>
            <p className={css.note}>{t('ic_source', { spec: card.sourceSpec === 'chara_card_v2' ? 'V2' : 'V3', converted: card.sourceSpec === 'chara_card_v2' ? ' (read as V3)' : '' })}{card.creator === '' ? '' : ` ${t('ic_creator')}: ${card.creator}.`}</p>
            {card.tags.length > 0 && <div className={css.tags}>{card.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}
            {card.ignored.scripts > 0 && <p className={css.note}>{t('ic_scripts', { count: card.ignored.scripts })}</p>}
          </div>
        </section>

        <section className={css.section}>
          <h3 className={css.heading}>{t('ic_fields')}</h3>
          <Text label={t('ic_fieldDescription')} text={card.description} t={t} />
          <Text label={t('ic_fieldPersonality')} text={card.personality} t={t} />
          <Text label={t('ic_fieldScenario')} text={card.scenario} t={t} />
          <Text label={t('ic_fieldExamples')} text={card.messageExample} t={t} />
          <Text label={t('ic_fieldNotes')} text={card.creatorNotes} t={t} />
          <Text label={t('ic_fieldInstructions')} text={[card.systemPrompt, card.postHistoryInstructions].filter(text => text.trim() !== '').join('\n\n')} t={t} note={t('ic_notCarried')} />
        </section>

        <section className={css.section}>
          <h3 className={css.heading}>{t('ic_opening')}</h3>
          <p className={css.note}>{t('ic_openingHelp')}</p>
          {greetings.map(greeting => (
            <label key={greeting.label} className={css.choice}>
              <input type="radio" name="opening" checked={same(opening, greeting.choice)} onChange={() => { setOpening(greeting.choice) }} />
              <span className={css.choiceText}><span className={css.fieldTitle}>{greeting.label}</span><span className={css.preview}>{greeting.text.trim().slice(0, 600)}</span></span>
            </label>
          ))}
          <label className={css.choice}>
            <input type="radio" name="opening" checked={opening.kind === 'none'} onChange={() => { setOpening({ kind: 'none' }) }} />
            <span className={css.choiceText}><span className={css.fieldTitle}>{t('ic_openingNone')}</span></span>
          </label>
        </section>

        {entries.length > 0 && (
          <section className={css.section}>
            <div className={css.row}>
              <h3 className={css.heading}>{t('ic_lorebook')}</h3>
              <span className={css.fieldMeta}>{t('ic_entryCount', { on, total: entries.length })}</span>
              <span className={css.space} />
              <Button variant="ghost" size="sm" onClick={() => { setOff(new Set()) }}>{t('ic_enableAll')}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setOff(new Set(entries.map(entry => entry.id))) }}>{t('ic_disableAll')}</Button>
            </div>
            <p className={css.note}>{t('ic_lorebookHelp')}</p>
            {entries.map(entry => (
              <div key={entry.id} className={`${css.entry} ${off.has(entry.id) ? css.entryOff : ''}`}>
                <div className={css.entryHead}>
                  <Switch checked={!off.has(entry.id)} label={entry.title || entry.id} onChange={(next) => { toggle(entry.id, next) }} />
                  <button type="button" className={css.entryTitle} onClick={() => { toggleOpen(entry.id) }} aria-expanded={open.has(entry.id)}>{entry.title === '' ? entry.id : entry.title}</button>
                  {entry.constant && <Tag>{t('ic_constant')}</Tag>}
                  <span className={css.fieldMeta}>{entry.content.length}</span>
                </div>
                {open.has(entry.id) && (
                  <>
                    <p className={css.note}>{entry.keys.length === 0 ? t('ic_noKeys') : t('ic_keys', { keys: entry.keys.join(', ') })}</p>
                    <pre className={css.text}>{entry.content}</pre>
                  </>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
