import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiceCheckDefinition } from 'dsh-roleplay-model'
import type { DiceDocument } from '../../shared/world-dice.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadDice, saveDice } from './world-files-api.ts'
import css from './CharactersPanel.module.css'

interface BandDraft { min: string; max: string; label: string; result: DiceCheckDefinition['bands'][number]['result']; critical: boolean }
interface CheckDraft { key: string; name: string; use: string; dice: string; reading: 'total' | 'successes'; hit: string; compare: 'absolute' | 'over' | 'under'; modifier: string; bands: BandDraft[] }

const draftOf = (dice: DiceDocument): CheckDraft[] => dice.checks.map(check => ({
  key: check.key, name: check.name, use: check.use, dice: check.dice, reading: check.reading ?? 'total', hit: check.hit === undefined ? '' : String(check.hit), compare: check.compare ?? 'absolute', modifier: check.modifier ?? '',
  bands: check.bands.map(band => ({ min: band.min === undefined ? '' : String(band.min), max: band.max === undefined ? '' : String(band.max), label: band.label, result: band.result, critical: band.critical === true })),
}))

const number = (text: string): number | undefined => (text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text))

const documentOf = (drafts: CheckDraft[]): DiceDocument => ({
  checks: drafts.map((check): DiceCheckDefinition => ({
    key: check.key.trim(), name: check.name.trim(), use: check.use.trim(), dice: check.dice.trim(),
    ...(check.reading === 'total' ? {} : { reading: check.reading }),
    ...(check.reading === 'successes' && number(check.hit) !== undefined ? { hit: number(check.hit)! } : {}),
    ...(check.compare === 'absolute' ? {} : { compare: check.compare }),
    ...(check.modifier.trim() === '' ? {} : { modifier: check.modifier.trim() }),
    bands: check.bands.map(band => ({ label: band.label.trim(), result: band.result, ...(number(band.min) === undefined ? {} : { min: number(band.min)! }), ...(number(band.max) === undefined ? {} : { max: number(band.max)! }), ...(band.critical ? { critical: true as const } : {}) })),
  })),
})

const blankBand = (): BandDraft => ({ min: '', max: '', label: '', result: 'succeeded', critical: false })
const blankCheck = (): CheckDraft => ({ key: '', name: '', use: '', dice: '1d20', reading: 'total', hit: '', compare: 'absolute', modifier: '', bands: [blankBand()] })

/** The dice checks of a world: what each is used for, the dice it rolls and the bands that say what a roll means. */
export function DicePanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [saved, setSaved] = useState<CheckDraft[]>()
  const [draft, setDraft] = useState<CheckDraft[]>([])
  const [status, setStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const abort = new AbortController()
    loadDice(worldId, abort.signal).then((value) => { const next = draftOf(value); setSaved(next); setDraft(next) }, (failure: unknown) => { if (!abort.signal.aborted) setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId])

  if (saved === undefined) return <p className={css.empty} role={status.state === 'failed' ? 'alert' : undefined}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : t('editorLoading')}</p>
  const dirty = JSON.stringify(documentOf(draft)) !== JSON.stringify(documentOf(saved))
  const change = (next: CheckDraft[]): void => { setDraft(next); setStatus({ state: 'idle' }) }
  const patch = (index: number, fields: Partial<CheckDraft>): void => { change(draft.map((entry, at) => (at === index ? { ...entry, ...fields } : entry))) }
  const patchBand = (index: number, band: number, fields: Partial<BandDraft>): void => { patch(index, { bands: draft[index]!.bands.map((entry, at) => (at === band ? { ...entry, ...fields } : entry)) }) }
  const save = (): void => {
    setStatus({ state: 'saving' })
    saveDice(worldId, documentOf(draft), new AbortController().signal).then(
      (value) => { const next = draftOf(value); setSaved(next); setDraft(next); setStatus({ state: 'saved' }) },
      (failure: unknown) => { setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }
  const text = (index: number, key: 'key' | 'name' | 'dice' | 'modifier' | 'hit', label: Parameters<Translate>[0], help?: Parameters<Translate>[0]) => (
    <label className={css.field}><span className={css.label}>{t(label)}</span><input className={css.nameInput} value={draft[index]![key]} onChange={(event) => { patch(index, { [key]: event.target.value }) }} />{help !== undefined && <span className={css.help}>{t(help)}</span>}</label>
  )

  return (
    <div className={css.panel} data-testid="roleplay-dice-editor">
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      {(dirty || status.state !== 'idle') && (
        <div className={css.bar} role="status">
          <span className={status.state === 'failed' ? css.error : css.barText}>{status.state === 'failed' ? t('saveFailed', { message: status.message ?? '' }) : dirty ? t('unsaved') : t('saved')}</span>
          {dirty && <Button variant="ghost" size="sm" onClick={() => { setDraft(saved); setStatus({ state: 'idle' }) }}>{t('reset')}</Button>}
          {dirty && <Button variant="primary" size="sm" disabled={status.state === 'saving'} onClick={save}>{status.state === 'saving' ? t('saving') : t('save')}</Button>}
        </div>
      )}
      <div className={css.body}>
        <article className={css.sheet}>
          <span className={css.help}>{t('dice_help')}</span>
          {draft.map((check, index) => (
            <section className={css.section} key={index} data-testid="roleplay-dice-check">
              <div className={css.grid}>
                {text(index, 'key', 'dice_key')}
                {text(index, 'name', 'dice_name')}
                <label className={`${css.field} ${css.wide}`}>
                  <span className={css.label}>{t('dice_use')}</span>
                  <textarea className={css.nameInput} rows={2} value={check.use} onChange={(event) => { patch(index, { use: event.target.value }) }} />
                  <span className={css.help}>{t('dice_useHelp')}</span>
                </label>
                {text(index, 'dice', 'dice_dice', 'dice_diceHelp')}
                <label className={css.field}>
                  <span className={css.label}>{t('dice_reading')}</span>
                  <select value={check.reading} onChange={(event) => { patch(index, { reading: event.target.value as CheckDraft['reading'] }) }}>
                    <option value="total">{t('dice_readTotal')}</option>
                    <option value="successes">{t('dice_readSuccesses')}</option>
                  </select>
                </label>
                {check.reading === 'successes' && text(index, 'hit', 'dice_hit')}
                <label className={css.field}>
                  <span className={css.label}>{t('dice_compare')}</span>
                  <select value={check.compare} onChange={(event) => { patch(index, { compare: event.target.value as CheckDraft['compare'] }) }}>
                    <option value="absolute">{t('dice_compareAbsolute')}</option>
                    <option value="over">{t('dice_compareOver')}</option>
                    <option value="under">{t('dice_compareUnder')}</option>
                  </select>
                  <span className={css.help}>{t('dice_compareHelp')}</span>
                </label>
                {text(index, 'modifier', 'dice_modifier', 'dice_modifierHelp')}
              </div>
              <span className={css.label}>{t('dice_bands')}</span>
              <span className={css.help}>{t('dice_bandsHelp')}</span>
              {check.bands.map((band, at) => (
                <div className={css.grid} key={at} data-testid="roleplay-dice-band">
                  <label className={css.field}><span className={css.label}>{t('dice_bandMin')}</span><input className={css.nameInput} value={band.min} onChange={(event) => { patchBand(index, at, { min: event.target.value }) }} /></label>
                  <label className={css.field}><span className={css.label}>{t('dice_bandMax')}</span><input className={css.nameInput} value={band.max} onChange={(event) => { patchBand(index, at, { max: event.target.value }) }} /></label>
                  <label className={css.field}><span className={css.label}>{t('dice_bandLabel')}</span><input className={css.nameInput} value={band.label} onChange={(event) => { patchBand(index, at, { label: event.target.value }) }} /></label>
                  <label className={css.field}>
                    <span className={css.label}>{t('dice_bandResult')}</span>
                    <select value={band.result} onChange={(event) => { patchBand(index, at, { result: event.target.value as BandDraft['result'] }) }}>
                      <option value="succeeded">{t('dice_resultSucceeded')}</option>
                      <option value="partial">{t('dice_resultPartial')}</option>
                      <option value="failed">{t('dice_resultFailed')}</option>
                    </select>
                  </label>
                  <label className={css.field}><span className={css.label}>{t('dice_bandCritical')}</span><input type="checkbox" checked={band.critical} onChange={(event) => { patchBand(index, at, { critical: event.target.checked }) }} /></label>
                  <Button variant="ghost" size="sm" onClick={() => { patch(index, { bands: check.bands.filter((_, other) => other !== at) }) }}>{t('dice_bandRemove')}</Button>
                </div>
              ))}
              <div className={css.grid}>
                <Button variant="ghost" size="sm" onClick={() => { patch(index, { bands: [...check.bands, blankBand()] }) }}>{t('dice_bandAdd')}</Button>
                <Button variant="ghost" size="sm" onClick={() => { change(draft.filter((_, other) => other !== index)) }}>{t('dice_remove')}</Button>
              </div>
            </section>
          ))}
          {draft.length === 0 && <p className={css.empty}>{t('dice_none')}</p>}
          <Button variant="ghost" size="sm" onClick={() => { change([...draft, blankCheck()]) }}>{t('dice_add')}</Button>
        </article>
      </div>
    </div>
  )
}
