import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_SETTINGS } from '../../../shared/settings.ts'
import { fromDrafts, problemsOf, toDrafts, type Drafts } from '../../settings-form/fields.ts'
import { useEmbeddingOptions } from '../../settings-form/embedding-options.ts'
import { SettingsFields } from '../../settings-form/SettingsFields.tsx'
import { languageName, useWorldLanguage } from './TranslateBanner.tsx'
import { storyLanguageOf } from './translate-api.ts'
import { AvatarChoices } from '../../widgets/avatar-choices/AvatarChoices.tsx'
import type { StartDialog, StartOptions } from './worlds-controller.ts'
import css from './StartSessionDialog.module.css'

/** Asks what a new session needs: its name and which playable character the player takes. */
export function StartSessionDialog({ t, dialog, onStart, onClose }: {
  t: TranslateNS<'roleplay.worlds'>
  dialog: StartDialog
  onStart: (options: StartOptions) => void
  onClose: () => void
}) {
  const formId = useId()
  const [name, setName] = useState(dialog.worldName)
  const [opening, setOpening] = useState('')
  const [startTime, setStartTime] = useState('')
  const [choice, setChoice] = useState<string | undefined>()
  const [brought, setBrought] = useState<ReadonlySet<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [drafts, setDrafts] = useState<Drafts | undefined>()
  // Only what has to be chosen before the first request; the rest can be changed in the chat's settings.
  const options = useEmbeddingOptions('start')
  const playable = dialog.characters.filter(character => character.role === 'playable')
  const bringing = dialog.avatars.filter(avatar => brought.has(avatar.key))
  // Who can be played: the world's own playable characters, then the avatars brought along. A choice is a world id or `avatar:<key>`.
  const players = [...playable.map(character => ({ value: character.id, name: character.name, summary: character.summary })), ...bringing.map(avatar => ({ value: `avatar:${avatar.key}`, name: avatar.name, summary: avatar.summary }))]
  const selected = players.find(player => player.value === choice)?.value ?? players[0]?.value
  const chosenOpening = opening === '' ? undefined : dialog.openings[Number(opening)]
  const openingValid = chosenOpening !== undefined && (chosenOpening.character === undefined || chosenOpening.character === selected)
  const base = { ...DEFAULT_SETTINGS, prompts: { language: t('language') } }
  const shown = { ...toDrafts(base, options), ...drafts }
  const written = useWorldLanguage(dialog.worldId)
  const chosen = shown['prompts.language']
  const played = storyLanguageOf(typeof chosen === 'string' && chosen.trim() !== '' ? chosen : t('language'))
  const canStart = dialog.status === 'ready' && selected !== undefined && !dialog.submitting && problemsOf(shown, options).size === 0

  return (
    <Modal
      open
      onClose={onClose}
      title={t('startTitle')}
      description={dialog.worldName}
      closeLabel={t('close')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={dialog.submitting}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canStart}>
            {dialog.submitting ? t('starting') : t('start')}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        className={css.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (canStart) onStart({ name, ...(selected.startsWith('avatar:') ? { playerAvatar: selected.slice('avatar:'.length) } : { playerCharacterId: selected }), avatars: bringing.map(avatar => avatar.key), ...(!openingValid ? {} : { opening: Number(opening) }), ...(startTime.trim() === '' || shown['clock.mode'] === 'real' ? {} : { startingTime: startTime.trim() }), settings: fromDrafts(base, shown, options) })
        }}
      >
        <label className={css.field}>
          <span className={css.label}>{t('sessionName')}</span>
          <Input value={name} maxLength={200} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} />
        </label>

        {written !== undefined && written !== played && <p className={css.message} role="status">{t('startLanguageNote', { from: languageName(t, written), to: languageName(t, played) })}</p>}

        <fieldset className={css.field} disabled={dialog.status !== 'ready' || dialog.submitting}>
          <legend className={css.label}>{t('playAs')}</legend>
          {dialog.status === 'loading' && <p className={css.message}>{t('loadingCharacters')}</p>}
          {dialog.status === 'failed' && <p className={css.error} role="alert">{t('charactersFailed', { message: dialog.error ?? '' })}</p>}
          {dialog.status === 'ready' && players.length === 0 && <p className={css.message}>{t('noPlayable')}</p>}
          {players.map(player => (
            <label key={player.value} className={css.option}>
              <input
                type="radio"
                name={`${formId}-player`}
                value={player.value}
                checked={selected === player.value}
                onChange={() => { setChoice(player.value) }}
              />
              <span className={css.optionText}>
                <span className={css.optionName}>{player.name}</span>
                {player.summary !== '' && <span className={css.optionSummary}>{player.summary}</span>}
              </span>
            </label>
          ))}
        </fieldset>

        {dialog.status === 'ready' && dialog.openings.some(entry => entry.character === undefined || entry.character === selected) && (
          <label className={css.field}>
            <span className={css.label}>{t('startOpening')}</span>
            <select value={openingValid ? opening : ''} disabled={dialog.submitting} onChange={(event) => { setOpening(event.target.value) }}>
              <option value="">{t('startOpeningDefault')}</option>
              {dialog.openings.flatMap((entry, index) => (entry.character === undefined || entry.character === selected ? [<option key={index} value={String(index)}>{entry.title}</option>] : []))}
            </select>
          </label>
        )}

        {dialog.status === 'ready' && shown['clock.mode'] !== 'real' && (
          <label className={css.field}>
            <span className={css.label}>{t('startTime')}</span>
            <input value={startTime} disabled={dialog.submitting} placeholder={dialog.startingTime === '' ? 'YYYY-MM-DDTHH:MM:SS' : dialog.startingTime} onChange={(event) => { setStartTime(event.target.value) }} />
            <span className={css.message}>{t('startTimeHelp', { zone: dialog.timeZone === '' ? 'UTC' : dialog.timeZone })}</span>
          </label>
        )}

        {dialog.status === 'ready' && dialog.avatars.length > 0 && (
          <fieldset className={css.field} disabled={dialog.submitting}>
            <legend className={css.label}>{t('startAvatars')}</legend>
            <p className={css.message}>{t('startAvatarsHelp')}</p>
            <AvatarChoices avatars={dialog.avatars} selected={brought} onToggle={(key) => { setBrought((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next }) }} />
          </fieldset>
        )}

        <div className={css.advanced}>
          <button
            type="button"
            className={css.advancedToggle}
            aria-expanded={showSettings}
            onClick={() => { setShowSettings(!showSettings) }}
          >
            <span aria-hidden>{showSettings ? '▾' : '▸'}</span>
            {t('advanced')}
          </button>
          {showSettings && (
            <div className={css.advancedBody}>
              <p className={css.message}>{t('advancedHelp')}</p>
              <SettingsFields t={t} drafts={shown} options={options} disabled={dialog.submitting} onChange={(key, value) => { setDrafts({ ...shown, [key]: value }) }} onPreset={(changes) => { setDrafts({ ...shown, ...changes }) }} />
            </div>
          )}
        </div>

        {dialog.status === 'ready' && dialog.error !== undefined && (
          <p className={css.error} role="alert">{t('startFailed', { message: dialog.error })}</p>
        )}
      </form>
    </Modal>
  )
}
