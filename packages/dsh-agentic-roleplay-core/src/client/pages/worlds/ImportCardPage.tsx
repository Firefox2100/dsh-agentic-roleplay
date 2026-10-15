import { useState } from 'react'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImportChoices, ImportPreview, OpeningChoice } from '../../../shared/import-card.ts'
import { discardImport, pictureUrl, startImport } from './import-api.ts'
import css from './ImportCardPage.module.css'

type T = TranslateNS<'roleplay.worlds'>

const same = (a: OpeningChoice, b: OpeningChoice): boolean => a.kind === b.kind && (a.kind !== 'alternate' || (b.kind === 'alternate' && a.index === b.index))

function Text({ label, text, t, note }: { label: string; text: string; t: T; note?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.field}>
      <button type="button" className={css.fieldHead} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <span className={css.fieldTitle}>{label}</span>
        <span className={css.fieldMeta}>{text.trim() === '' ? t('importEmpty') : `${text.length}`}</span>
      </button>
      {note !== undefined && <p className={css.note}>{note}</p>}
      {open && text.trim() !== '' && <pre className={css.text}>{text}</pre>}
    </div>
  )
}

/** What an uploaded card holds, for the person to look through and decide what becomes of it: which lorebook entries are read at all, and which greeting opens the story. */
export function ImportCardPage({ t, preview, onCancelled, onStarted }: { t: T; preview: ImportPreview; onCancelled: () => void; onStarted: (chatSessionId: string, started: boolean) => void }) {
  const { card } = preview
  const entries = card.book?.entries ?? []
  const [name, setName] = useState(preview.choices.name)
  const [off, setOff] = useState(() => new Set(preview.choices.disabledEntries))
  const [opening, setOpening] = useState<OpeningChoice>(preview.choices.opening)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  const greetings: { choice: OpeningChoice; label: string; text: string }[] = [
    ...(card.firstMessage.trim() === '' ? [] : [{ choice: { kind: 'first' } as OpeningChoice, label: t('importOpeningFirst'), text: card.firstMessage }]),
    ...card.alternateGreetings.flatMap((text, index) => (text.trim() === '' ? [] : [{ choice: { kind: 'alternate', index } as OpeningChoice, label: t('importOpeningAlternate', { number: index + 1 }), text }])),
  ]
  const toggle = (id: string, on: boolean): void => { const next = new Set(off); if (on) next.delete(id); else next.add(id); setOff(next) }
  const toggleOpen = (id: string): void => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next) }
  const choices = (): ImportChoices => ({ name: name.trim(), disabledEntries: [...off], opening })

  const start = (): void => {
    if (name.trim() === '' || starting) return
    setStarting(true)
    setError(undefined)
    startImport(preview.id, choices(), t('language')).then(
      (started) => { onStarted(started.chatSessionId, started.started) },
      (failure: unknown) => { setStarting(false); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }
  const cancel = (): void => { void discardImport(preview.id).finally(onCancelled) }
  const on = entries.length - off.size

  return (
    <div className={css.page} data-testid="roleplay-import">
      <div className={css.header}>
        <span className={css.title}>{t('importTitle')}</span>
        <span className={css.space} />
        <Button variant="ghost" size="sm" disabled={starting} onClick={cancel}>{t('importCancel')}</Button>
        <Button variant="primary" size="sm" disabled={name.trim() === '' || starting} onClick={start}>{starting ? t('importStarting') : t('importStart')}</Button>
      </div>
      {error !== undefined && <p className={css.error} role="alert">{t('importStartFailed', { message: error })}</p>}
      <div className={css.body}>
        <section className={css.top}>
          {preview.hasAvatar
            ? <img className={css.picture} src={pictureUrl(preview.id)} alt="" loading="lazy" decoding="async" />
            : <div className={`${css.picture} ${css.noPicture}`}>{t('importNoPicture')}</div>}
          <div className={css.about}>
            <label className={css.label}>
              <span>{t('importWorldName')}</span>
              <Input value={name} maxLength={200} onChange={(event) => { setName(event.target.value) }} />
            </label>
            <p className={css.note}>{t('importSource', { spec: card.sourceSpec === 'chara_card_v2' ? 'V2' : 'V3', converted: card.sourceSpec === 'chara_card_v2' ? ' (read as V3)' : '' })}{card.creator === '' ? '' : ` ${t('importCreator')}: ${card.creator}.`}</p>
            {card.tags.length > 0 && <div className={css.tags}>{card.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}
            {card.ignored.scripts > 0 && <p className={css.note}>{t('importScripts', { count: card.ignored.scripts })}</p>}
          </div>
        </section>

        <section className={css.section}>
          <h3 className={css.heading}>{t('importFields')}</h3>
          <Text label={t('importFieldDescription')} text={card.description} t={t} />
          <Text label={t('importFieldPersonality')} text={card.personality} t={t} />
          <Text label={t('importFieldScenario')} text={card.scenario} t={t} />
          <Text label={t('importFieldExamples')} text={card.messageExample} t={t} />
          <Text label={t('importFieldNotes')} text={card.creatorNotes} t={t} />
          <Text label={t('importFieldInstructions')} text={[card.systemPrompt, card.postHistoryInstructions].filter(text => text.trim() !== '').join('\n\n')} t={t} note={t('importNotCarried')} />
        </section>

        <section className={css.section}>
          <h3 className={css.heading}>{t('importOpening')}</h3>
          <p className={css.note}>{t('importOpeningHelp')}</p>
          {greetings.map(greeting => (
            <label key={greeting.label} className={css.choice}>
              <input type="radio" name="opening" checked={same(opening, greeting.choice)} onChange={() => { setOpening(greeting.choice) }} />
              <span className={css.choiceText}><span className={css.fieldTitle}>{greeting.label}</span><span className={css.preview}>{greeting.text.trim().slice(0, 600)}</span></span>
            </label>
          ))}
          <label className={css.choice}>
            <input type="radio" name="opening" checked={opening.kind === 'none'} onChange={() => { setOpening({ kind: 'none' }) }} />
            <span className={css.choiceText}><span className={css.fieldTitle}>{t('importOpeningNone')}</span></span>
          </label>
        </section>

        {entries.length > 0 && (
          <section className={css.section}>
            <div className={css.row}>
              <h3 className={css.heading}>{t('importLorebook')}</h3>
              <span className={css.fieldMeta}>{t('importEntryCount', { on, total: entries.length })}</span>
              <span className={css.space} />
              <Button variant="ghost" size="sm" onClick={() => { setOff(new Set()) }}>{t('importEnableAll')}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setOff(new Set(entries.map(entry => entry.id))) }}>{t('importDisableAll')}</Button>
            </div>
            <p className={css.note}>{t('importLorebookHelp')}</p>
            {entries.map(entry => (
              <div key={entry.id} className={`${css.entry} ${off.has(entry.id) ? css.entryOff : ''}`}>
                <div className={css.entryHead}>
                  <Switch checked={!off.has(entry.id)} label={entry.title || entry.id} onChange={(next) => { toggle(entry.id, next) }} />
                  <button type="button" className={css.entryTitle} onClick={() => { toggleOpen(entry.id) }} aria-expanded={open.has(entry.id)}>{entry.title === '' ? entry.id : entry.title}</button>
                  {entry.constant && <Tag>{t('importConstant')}</Tag>}
                  <span className={css.fieldMeta}>{entry.content.length}</span>
                </div>
                {open.has(entry.id) && (
                  <>
                    <p className={css.note}>{entry.keys.length === 0 ? t('importNoKeys') : t('importKeys', { keys: entry.keys.join(', ') })}</p>
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
