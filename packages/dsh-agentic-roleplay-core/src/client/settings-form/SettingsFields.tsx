import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SettingsFields.module.css'
import { FORM_FIELDS, boundsOf, keyOf, problemsOf, type Drafts } from './fields.ts'
import type { SettingsFormKey } from './locales.ts'

/** The settings of a chat as editable fields: one control with its explanation under each. */
export function SettingsFields({ t, drafts, onChange, disabled = false }: {
  t: (key: SettingsFormKey, values?: Record<string, string | number>) => string
  drafts: Drafts
  onChange: (key: string, value: string | boolean) => void
  disabled?: boolean
}) {
  const bad = problemsOf(drafts)
  return (
    <>
      {FORM_FIELDS.map((field) => {
        const key = keyOf(field)
        const { min, max } = boundsOf(field)
        return (
          <div key={key} className={css.row}>
            <label className={css.field}>
              <span className={css.label}>{t(field.label)}</span>
              {field.kind === 'flag'
                ? <Switch checked={drafts[key] === true} label={t(field.label)} disabled={disabled} onChange={(next) => { onChange(key, next) }} />
                : (
                    <Input
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      value={String(drafts[key] ?? '')}
                      disabled={disabled}
                      aria-invalid={bad.has(key)}
                      onChange={(event) => { onChange(key, event.target.value) }}
                    />
                  )}
            </label>
            <p className={css.help}>{t(field.help)}</p>
            {bad.has(key) && <p className={css.error}>{t('invalid', { min, max })}</p>}
          </div>
        )
      })}
    </>
  )
}
