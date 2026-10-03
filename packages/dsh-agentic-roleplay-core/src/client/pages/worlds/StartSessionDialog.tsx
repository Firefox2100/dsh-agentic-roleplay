import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_SETTINGS } from '../../../shared/settings.ts'
import { fromDrafts, problemsOf, toDrafts, type Drafts } from '../../settings-form/fields.ts'
import { SettingsFields } from '../../settings-form/SettingsFields.tsx'
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
  const [choice, setChoice] = useState<string | undefined>()
  const [showSettings, setShowSettings] = useState(false)
  const [drafts, setDrafts] = useState<Drafts | undefined>()
  const playable = dialog.characters.filter(character => character.role === 'playable')
  const selected = choice ?? playable[0]?.id
  const shown = drafts ?? toDrafts(DEFAULT_SETTINGS)
  const canStart = dialog.status === 'ready' && selected !== undefined && !dialog.submitting && problemsOf(shown).size === 0

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
          if (canStart) onStart({ name, playerCharacterId: selected, ...(drafts === undefined ? {} : { settings: fromDrafts(DEFAULT_SETTINGS, drafts) }) })
        }}
      >
        <label className={css.field}>
          <span className={css.label}>{t('sessionName')}</span>
          <Input value={name} maxLength={200} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} />
        </label>

        <fieldset className={css.field} disabled={dialog.status !== 'ready' || dialog.submitting}>
          <legend className={css.label}>{t('playAs')}</legend>
          {dialog.status === 'loading' && <p className={css.message}>{t('loadingCharacters')}</p>}
          {dialog.status === 'failed' && <p className={css.error} role="alert">{t('charactersFailed', { message: dialog.error ?? '' })}</p>}
          {dialog.status === 'ready' && playable.length === 0 && <p className={css.message}>{t('noPlayable')}</p>}
          {playable.map(character => (
            <label key={character.id} className={css.option}>
              <input
                type="radio"
                name={`${formId}-player`}
                value={character.id}
                checked={selected === character.id}
                onChange={() => { setChoice(character.id) }}
              />
              <span className={css.optionText}>
                <span className={css.optionName}>{character.name}</span>
                {character.summary !== '' && <span className={css.optionSummary}>{character.summary}</span>}
              </span>
            </label>
          ))}
        </fieldset>

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
              <SettingsFields t={t} drafts={shown} disabled={dialog.submitting} onChange={(key, value) => { setDrafts({ ...shown, [key]: value }) }} />
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
