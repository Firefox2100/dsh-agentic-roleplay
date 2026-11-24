import { useEffect, useState } from 'react'
import { MAX_KEEP_RESULT_TURNS, TOOL_HIDING, isKeepResultTurns, type AuthoringSettings, type ToolHiding } from '../../shared/authoring-settings.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import { loadAuthoringSettings, saveAuthoringSettings } from './settings-api.ts'
import { Input } from '../ui/Input.tsx'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const LABELS: Record<ToolHiding, ChatSettingsLocaleKey> = { off: 'authoringHideOff', card: 'authoringHideCard', phase: 'authoringHidePhase' }
const HELPS: Record<ToolHiding, ChatSettingsLocaleKey> = { off: 'authoringHideOffHelp', card: 'authoringHideCardHelp', phase: 'authoringHidePhaseHelp' }

/** The settings of a world's authoring conversations: which of the assistant's tools are left out of its requests while they cannot be used. */
export function AuthoringSettingsView({ t, world }: { t: Translate; world: string }) {
  const [settings, setSettings] = useState<AuthoringSettings | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    loadAuthoringSettings(world, abort.signal).then(setSettings, (failure: unknown) => {
      if (!abort.signal.aborted) setError(t('loadFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
    })
    return () => { abort.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the translator is only used to word an error
  }, [world])

  const choose = (change: Partial<AuthoringSettings>): void => {
    setSaving(true)
    setError(undefined)
    saveAuthoringSettings(world, change, new AbortController().signal).then(
      setSettings,
      (failure: unknown) => { setError(t('saveFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    ).finally(() => { setSaving(false) })
  }

  return (
    <div className={css.view} data-testid="roleplay-authoring-settings">
      <h2 className={css.title}>{t('authoringTitle')}</h2>
      <p className={css.description}>{t('authoringDescription')}</p>
      {settings === undefined && error === undefined && <p className={css.message}>{t('loading')}</p>}
      {settings !== undefined && (
        <fieldset className={css.choices} disabled={saving}>
          <legend className={css.label}>{t('authoringHideTitle')}</legend>
          {TOOL_HIDING.map(mode => (
            <label key={mode} className={css.choice} htmlFor={`tool-hiding-${mode}`}>
              <input id={`tool-hiding-${mode}`} type="radio" name="tool-hiding" value={mode} checked={settings.toolHiding === mode} onChange={() => { choose({ toolHiding: mode }) }} />
              <span className={css.choiceText}>
                <span>{t(LABELS[mode])}</span>
                <span className={css.help}>{t(HELPS[mode])}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {settings !== undefined && (
        <label className={css.field}>
          <span className={css.label}>{t('authoringKeepTitle')}</span>
          <Input
            type="number" min={0} max={MAX_KEEP_RESULT_TURNS} step={1} disabled={saving} defaultValue={settings.keepResultTurns} key={settings.keepResultTurns}
            onBlur={(event) => { const value = Number(event.target.value); if (event.target.value.trim() !== '' && isKeepResultTurns(value) && value !== settings.keepResultTurns) choose({ keepResultTurns: value }); else event.target.value = String(settings.keepResultTurns) }}
          />
          <span className={css.help}>{t('authoringKeepHelp', { max: MAX_KEEP_RESULT_TURNS })}</span>
        </label>
      )}
      <p className={css.help}>{t('authoringCacheNote')}</p>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}
